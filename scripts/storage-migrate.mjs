import { existsSync, openSync, closeSync, unlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJson, readKey, readString } from "./lib/json.mjs";
import { preflightStorageRelease } from "./lib/storage-compatibility.mjs";
import { readCheckpoint, saveCheckpoint } from "./lib/storage-checkpoint.mjs";
import { migrateStorage, StorageMigrationError } from "./lib/storage-migration.mjs";
import { createStorageValidator } from "./lib/storage-validator.mjs";

/** @typedef {{table: string, endpoint?: string, profile?: string, checkpoint: string, apply: boolean, resume: boolean, maxPages?: number}} Options */

/** @param {string[]} args @returns {Options} */
function optionsOf(args) {
  /** @type {Map<string, string | true>} */
  const pairs = new Map();
  const flags = new Set(["--apply", "--dry-run", "--resume", "--writers-stopped"]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === undefined || pairs.has(flag))
      throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
    if (flags.has(flag)) pairs.set(flag, true);
    else {
      const value = args[index + 1];
      if (
        !["--table", "--endpoint", "--profile", "--checkpoint", "--max-pages"].includes(
          flag,
        ) ||
        value === undefined ||
        value.startsWith("--")
      )
        throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
      pairs.set(flag, value);
      index += 1;
    }
  }
  const table = pairs.get("--table"),
    checkpoint = pairs.get("--checkpoint"),
    endpoint = pairs.get("--endpoint"),
    profile = pairs.get("--profile");
  if (
    typeof table !== "string" ||
    typeof checkpoint !== "string" ||
    !checkpoint.endsWith(".json") ||
    /(?:^|\/)secrets(?:\/|$)/.test(checkpoint) ||
    (pairs.has("--apply") && pairs.has("--dry-run")) ||
    (pairs.has("--apply") && !pairs.has("--writers-stopped"))
  )
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  if (
    endpoint !== undefined &&
    (typeof endpoint !== "string" ||
      !/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+\/?$/.test(endpoint))
  )
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  if (
    endpoint === undefined &&
    (typeof profile !== "string" || !table.startsWith("instant-composition-dev-"))
  )
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  const pages = pairs.get("--max-pages"),
    maxPages = pages === undefined ? undefined : Number(pages);
  if (maxPages !== undefined && (!Number.isSafeInteger(maxPages) || maxPages < 1))
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  return {
    table,
    checkpoint,
    apply: pairs.has("--apply"),
    resume: pairs.has("--resume"),
    ...(typeof endpoint === "string" ? { endpoint } : {}),
    ...(typeof profile === "string" ? { profile } : {}),
    ...(maxPages === undefined ? {} : { maxPages }),
  };
}

/** @param {string} encoded @returns {{PK: string, SK: string}} */
function keyOf(encoded) {
  const value = parseJson(encoded);
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "string" ||
    typeof value[1] !== "string"
  )
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  return { PK: value[0], SK: value[1] };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function rowOf(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {string[]} args @returns {Promise<import('./lib/storage-migration.mjs').Checkpoint>} */
export async function main(args) {
  const options = optionsOf(args);
  const root = fileURLToPath(new URL("../", import.meta.url));
  preflightStorageRelease(root, "storage-v1");
  const file = path.resolve(options.checkpoint),
    lock = `${file}.lock`;
  if (!options.resume && existsSync(file))
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  const checkpoint = options.resume ? readCheckpoint(file) : undefined;
  // A dry-run makes no local or remote writes, including lock/checkpoint files.
  const descriptor = options.apply ? openSync(lock, "wx", 0o600) : undefined;
  const validator = createStorageValidator(options.profile);
  const target = {
    table: options.table,
    region: "ap-northeast-1",
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
  };
  /** @param {string} command @param {Record<string,unknown>} fields @returns {Promise<unknown>} */
  const request = async (command, fields) =>
    readKey(await validator.request({ ...target, command, ...fields }), "result");
  try {
    return await migrateStorage(
      {
        async page(cursor) {
          const page = await request("page", { cursor });
          const rows = readKey(page, "rows");
          if (!Array.isArray(rows))
            throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
          return { rows: rows.map(rowOf), cursor: readKey(page, "cursor") ?? null };
        },
        async get(key) {
          const row = await request("get", { key: keyOf(key) });
          return row === null ? undefined : rowOf(row);
        },
        async replace(key, row, version, schema) {
          return (
            (await request("replace", { key: keyOf(key), row, version, schema })) ===
            true
          );
        },
        save(state) {
          saveCheckpoint(file, state);
          return Promise.resolve();
        },
      },
      {
        id: "legacy-to-storage-v1",
        target: JSON.stringify(target),
        sourceSchemas: [0],
        targetSchema: 1,
        async transform(row) {
          const decoded = readKey(await validator.request([row]), "rows");
          if (!Array.isArray(decoded))
            throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
          /** @type {unknown} */ const record = decoded[0];
          const value = readKey(record, "targetValue");
          return {
            PK: readString(row, "PK"),
            SK: readString(row, "SK"),
            type: readString(record, "type"),
            version: readKey(record, "version"),
            schemaVersion: 1,
            value,
            ...(["talk", "vocabReadModel", "vocabCandidate"].includes(
              readString(record, "type") ?? "",
            ) && typeof readKey(value, "expiresAt") === "number"
              ? { expiresAt: readKey(value, "expiresAt") }
              : {}),
          };
        },
      },
      {
        dryRun: !options.apply,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
      },
    );
  } finally {
    await validator.close();
    if (descriptor !== undefined) {
      closeSync(descriptor);
      unlinkSync(lock);
    }
  }
}
if (import.meta.main) {
  try {
    const state = await main(process.argv.slice(2));
    process.stdout.write(
      `${JSON.stringify({ complete: state.complete, seen: state.seen, migrated: state.migrated, unchanged: state.unchanged })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof StorageMigrationError ? error.message : "ERR_STORAGE_MIGRATION_FAILED: Migration stopped. Expected: compatible data, a unique checkpoint and working dev access. Next: preserve the checkpoint, inspect access/compatibility, then --resume."}\n`,
    );
    process.exitCode = 1;
  }
}
