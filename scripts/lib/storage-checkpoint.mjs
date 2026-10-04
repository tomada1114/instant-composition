import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { parseJson, readKey, readString } from "./json.mjs";
import { StorageMigrationError } from "./storage-migration.mjs";

/** @param {unknown} value @param {string} key @returns {number} */
function count(value, key) {
  const result = readKey(value, key);
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0)
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  return result;
}

/** @param {unknown} value @returns {import('./storage-migration.mjs').Checkpoint} */
export function checkpointOf(value) {
  const migration = readString(value, "migration"),
    target = readString(value, "target"),
    pending = readKey(value, "pending");
  const complete = readKey(value, "complete"),
    pageOpen = readKey(value, "pageOpen");
  if (
    migration === undefined ||
    target === undefined ||
    !Array.isArray(pending) ||
    typeof complete !== "boolean" ||
    typeof pageOpen !== "boolean"
  )
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  return {
    migration,
    target,
    complete,
    pageOpen,
    targetSchema: count(value, "targetSchema"),
    seen: count(value, "seen"),
    migrated: count(value, "migrated"),
    unchanged: count(value, "unchanged"),
    cursor: readKey(value, "cursor") ?? null,
    nextCursor: readKey(value, "nextCursor") ?? null,
    pending: pending.map((entry) => {
      const key = readString(entry, "key"),
        digest = readString(entry, "digest"),
        done = readKey(entry, "done");
      if (
        key === undefined ||
        digest === undefined ||
        !/^[a-f0-9]{64}$/.test(digest) ||
        typeof done !== "boolean"
      )
        throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
      return {
        key,
        digest,
        done,
        version: count(entry, "version"),
        sourceSchema: count(entry, "sourceSchema"),
      };
    }),
  };
}

/** @param {string} file @returns {import('./storage-migration.mjs').Checkpoint} */
export function readCheckpoint(file) {
  return checkpointOf(parseJson(readFileSync(file, "utf8")));
}
/** Atomic checkpoint replacement; contains keys/digests/counters, no learner values.
 * @param {string} file @param {import('./storage-migration.mjs').Checkpoint} checkpoint @returns {void}
 */
export function saveCheckpoint(file, checkpoint) {
  const temporary = `${file}.next`;
  writeFileSync(temporary, JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
  renameSync(temporary, file);
}
