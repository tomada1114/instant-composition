import { createHash } from "node:crypto";
import { readKey, readString } from "./json.mjs";

/** @typedef {Readonly<Record<string, unknown>>} MigrationRow */
/** @typedef {{key: string, version: number, sourceSchema: number, digest: string, done: boolean}} PendingRow */
/** @typedef {{migration: string, target: string, targetSchema: number, cursor: unknown, nextCursor: unknown, seen: number, migrated: number, unchanged: number, pending: PendingRow[], pageOpen: boolean, complete: boolean}} Checkpoint */
/** @typedef {{id: string, target: string, sourceSchemas: readonly number[], targetSchema: number, transform: (row: MigrationRow) => Promise<MigrationRow>}} Migration */
/** @typedef {{page: (cursor: unknown) => Promise<{rows: MigrationRow[], cursor: unknown}>, get: (key: string) => Promise<MigrationRow | undefined>, replace: (key: string, row: MigrationRow, version: number, schema: number) => Promise<boolean>, save: (checkpoint: Checkpoint) => Promise<void>}} MigrationPort */

export class StorageMigrationError extends Error {
  /** @readonly @type {"ERR_STORAGE_MIGRATION_FORMAT" | "ERR_STORAGE_MIGRATION_CONFLICT" | "ERR_STORAGE_MIGRATION_COUNT"} */
  code;
  /** @param {StorageMigrationError["code"]} code */
  constructor(code) {
    super(
      `${code}: Migration refused. Expected: a compatible stable inventory. Next: inspect the checkpoint and deploy a compatible forward fix before resuming.`,
    );
    this.name = "StorageMigrationError";
    this.code = code;
  }
}

/** @param {unknown} value @returns {string} */
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(readKey(value, key))}`)
      .join(",")}}`;
  throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
}

/** Digest excludes optimistic version, so a resumed successful CAS is identifiable.
 * @param {MigrationRow} row @returns {string}
 */
function digest(row) {
  const content = Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "version"),
  );
  return createHash("sha256").update(canonical(content)).digest("hex");
}

/** @param {MigrationRow} row @returns {number} */
function versionOf(row) {
  const version = readKey(row, "version");
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1)
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  return version;
}

/** @param {MigrationRow} row @returns {number} */
function schemaOf(row) {
  const schema = readKey(row, "schemaVersion") ?? 0;
  if (typeof schema !== "number" || !Number.isSafeInteger(schema) || schema < 0)
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  return schema;
}

/** @param {MigrationRow} row @returns {string} */
function keyOf(row) {
  const pk = readString(row, "PK"),
    sk = readString(row, "SK");
  if (pk === undefined || sk === undefined)
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
  return JSON.stringify([pk, sk]);
}

/** @param {Migration} migration @returns {Checkpoint} */
export function initialCheckpoint(migration) {
  return {
    migration: migration.id,
    target: migration.target,
    targetSchema: migration.targetSchema,
    cursor: null,
    nextCursor: null,
    seen: 0,
    migrated: 0,
    unchanged: 0,
    pending: [],
    pageOpen: false,
    complete: false,
  };
}

/** Validate resumed state; counters and target identity cannot silently drift.
 * @param {Checkpoint} checkpoint @param {Migration} migration @returns {void}
 */
function check(checkpoint, migration) {
  if (
    checkpoint.migration !== migration.id ||
    checkpoint.target !== migration.target ||
    checkpoint.targetSchema !== migration.targetSchema ||
    ![checkpoint.seen, checkpoint.migrated, checkpoint.unchanged].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    checkpoint.migrated + checkpoint.unchanged > checkpoint.seen ||
    checkpoint.pending.length > 100 ||
    new Set(checkpoint.pending.map((row) => row.key)).size !== checkpoint.pending.length
  )
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
}

/** A bounded resumable migration. Dry runs call neither replace nor save.
 * @param {MigrationPort} port @param {Migration} migration @param {{dryRun: boolean, checkpoint?: Checkpoint, maxPages?: number}} options
 * @returns {Promise<Checkpoint>}
 */
export async function migrateStorage(port, migration, options) {
  const state = globalThis.structuredClone(
    options.checkpoint ?? initialCheckpoint(migration),
  );
  check(state, migration);
  if (state.complete) {
    await verifyStorageMigration(port, migration, state);
    return state;
  }
  let pages = 0;
  while (pages < (options.maxPages ?? Number.MAX_SAFE_INTEGER)) {
    if (!state.pageOpen) {
      const page = await port.page(state.cursor);
      if (page.rows.length > 100)
        throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
      /** @type {PendingRow[]} */
      const pending = [];
      for (const row of page.rows) {
        const schema = schemaOf(row);
        const transformed = await migration.transform(row);
        if (
          schemaOf(transformed) !== migration.targetSchema ||
          keyOf(transformed) !== keyOf(row)
        )
          throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
        state.seen += 1;
        if (schema === migration.targetSchema) {
          if (digest(row) !== digest(transformed))
            throw new StorageMigrationError("ERR_STORAGE_MIGRATION_CONFLICT");
          state.unchanged += 1;
        } else {
          if (!migration.sourceSchemas.includes(schema))
            throw new StorageMigrationError("ERR_STORAGE_MIGRATION_FORMAT");
          pending.push({
            key: keyOf(row),
            version: versionOf(row),
            sourceSchema: schema,
            digest: digest(transformed),
            done: false,
          });
        }
      }
      state.pending = pending;
      state.pageOpen = true;
      state.nextCursor = page.cursor;
      if (!options.dryRun) await port.save(globalThis.structuredClone(state));
    }
    for (const pending of state.pending) {
      if (pending.done) continue;
      const existing = await port.get(pending.key);
      if (existing === undefined)
        throw new StorageMigrationError("ERR_STORAGE_MIGRATION_CONFLICT");
      if (schemaOf(existing) === migration.targetSchema) {
        if (
          versionOf(existing) !== pending.version + 1 ||
          digest(existing) !== pending.digest
        )
          throw new StorageMigrationError("ERR_STORAGE_MIGRATION_CONFLICT");
      } else {
        const next = await migration.transform(existing);
        if (
          versionOf(existing) !== pending.version ||
          schemaOf(existing) !== pending.sourceSchema ||
          digest(next) !== pending.digest
        )
          throw new StorageMigrationError("ERR_STORAGE_MIGRATION_CONFLICT");
        if (
          !options.dryRun &&
          !(await port.replace(
            pending.key,
            { ...next, version: pending.version + 1 },
            pending.version,
            pending.sourceSchema,
          ))
        )
          throw new StorageMigrationError("ERR_STORAGE_MIGRATION_CONFLICT");
      }
      pending.done = true;
      state.migrated += 1;
      if (!options.dryRun) await port.save(globalThis.structuredClone(state));
    }
    state.cursor = state.nextCursor;
    state.pending = [];
    state.pageOpen = false;
    pages += 1;
    if (state.cursor === null) {
      state.complete = true;
      if (!options.dryRun) {
        await verifyStorageMigration(port, migration, state);
        await port.save(globalThis.structuredClone(state));
      }
      return state;
    }
    if (!options.dryRun) await port.save(globalThis.structuredClone(state));
  }
  return state;
}

/** A replay verifies counts and target shape without rewriting already-current rows.
 * @param {MigrationPort} port @param {Migration} migration @param {Checkpoint} checkpoint @returns {Promise<void>}
 */
export async function verifyStorageMigration(port, migration, checkpoint) {
  check(checkpoint, migration);
  let cursor = null,
    count = 0;
  do {
    const page = await port.page(cursor);
    for (const row of page.rows) {
      if (
        schemaOf(row) !== migration.targetSchema ||
        digest(row) !== digest(await migration.transform(row))
      )
        throw new StorageMigrationError("ERR_STORAGE_MIGRATION_COUNT");
      count += 1;
    }
    cursor = page.cursor;
  } while (cursor !== null);
  if (
    count !== checkpoint.seen ||
    checkpoint.migrated + checkpoint.unchanged !== checkpoint.seen
  )
    throw new StorageMigrationError("ERR_STORAGE_MIGRATION_COUNT");
}
