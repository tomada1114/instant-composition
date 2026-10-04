import { describe, expect, it } from "vitest";
import {
  migrateStorage,
  initialCheckpoint,
  StorageMigrationError,
  type Migration,
  type MigrationPort,
  type MigrationRow,
  type Checkpoint,
} from "../scripts/lib/storage-migration.mjs";

function harness(): {
  port: MigrationPort;
  migration: Migration;
  rows: Map<string, MigrationRow>;
  saved: Checkpoint[];
  writes: string[];
} {
  const rows = new Map<string, MigrationRow>(
    ["a", "b", "c", "d"].map((SK) => [
      JSON.stringify(["LEARNER#fixture", SK]),
      {
        PK: "LEARNER#fixture",
        SK,
        type: "fixture",
        version: 4,
        schemaVersion: 1,
        value: { oldRequired: "retained" },
      },
    ]),
  );
  const saved: Checkpoint[] = [],
    writes: string[] = [];
  const migration: Migration = {
    id: "rename-required-v2",
    target: "fixture-table",
    sourceSchemas: [1],
    targetSchema: 2,
    transform(row) {
      return Promise.resolve({
        ...row,
        schemaVersion: 2,
        value: { newRequired: "retained" },
      });
    },
  };
  const port: MigrationPort = {
    page(cursor) {
      const offset = typeof cursor === "number" ? cursor : 0;
      return Promise.resolve({
        rows: [...rows.values()].slice(offset, offset + 2),
        cursor: offset + 2 < rows.size ? offset + 2 : null,
      });
    },
    get(key) {
      return Promise.resolve(structuredClone(rows.get(key)));
    },
    replace(key, row, version, schema) {
      const previous = rows.get(key);
      if (previous?.["version"] !== version || previous["schemaVersion"] !== schema)
        return Promise.resolve(false);
      writes.push(key);
      rows.set(key, structuredClone(row));
      return Promise.resolve(true);
    },
    save(state) {
      saved.push(structuredClone(state));
      return Promise.resolve();
    },
  };
  return { port, migration, rows, saved, writes };
}

describe("versioned migration", () => {
  it("dry-runs a noncompatible required-field rename without writes or checkpoints", async () => {
    const h = harness();
    expect(await migrateStorage(h.port, h.migration, { dryRun: true })).toMatchObject({
      complete: true,
      seen: 4,
      migrated: 4,
      unchanged: 0,
    });
    expect(h.writes).toStrictEqual([]);
    expect(h.saved).toStrictEqual([]);
    expect([...h.rows.values()].every((row) => row["schemaVersion"] === 1)).toBe(true);
  });
  it("resumes a cursor checkpoint and replays completion with no repeated writes", async () => {
    const h = harness();
    const paused = await migrateStorage(h.port, h.migration, {
      dryRun: false,
      maxPages: 1,
    });
    expect(paused).toMatchObject({ complete: false, cursor: 2, seen: 2, migrated: 2 });
    const complete = await migrateStorage(h.port, h.migration, {
      dryRun: false,
      checkpoint: paused,
    });
    expect(complete).toMatchObject({
      complete: true,
      seen: 4,
      migrated: 4,
      unchanged: 0,
    });
    expect(new Set(h.writes).size).toBe(4);
    await migrateStorage(h.port, h.migration, { dryRun: false, checkpoint: complete });
    expect(h.writes).toHaveLength(4);
    expect([...h.rows.values()].map((row) => row["version"])).toStrictEqual([
      5, 5, 5, 5,
    ]);
  });
  it("recovers a successful conditional write whose acknowledgement checkpoint was lost", async () => {
    const h = harness();
    let interrupted = false;
    const interruptedPort = {
      ...h.port,
      save(state: Checkpoint) {
        if (!interrupted && state.migrated === 1) {
          interrupted = true;
          return Promise.reject(new Error("fixture interruption"));
        }
        return h.port.save(state);
      },
    };
    await expect(
      migrateStorage(interruptedPort, h.migration, { dryRun: false }),
    ).rejects.toThrow(Error);
    const checkpoint = h.saved.at(-1);
    expect(checkpoint).toBeDefined();
    if (checkpoint === undefined) throw new Error("Missing fixture checkpoint");
    expect(checkpoint).toMatchObject({ seen: 2, migrated: 0, pageOpen: true });
    const resumed = await migrateStorage(h.port, h.migration, {
      dryRun: false,
      checkpoint,
    });
    expect(resumed).toMatchObject({ complete: true, seen: 4, migrated: 4 });
    expect(h.writes).toHaveLength(4);
  });
  it("refuses a competing change instead of overwriting it on resume", async () => {
    const h = harness();
    const paused = await migrateStorage(h.port, h.migration, {
      dryRun: false,
      maxPages: 1,
    });
    const key = JSON.stringify(["LEARNER#fixture", "c"]);
    const row = h.rows.get(key);
    h.rows.set(key, { ...row, version: 88, schemaVersion: 99 });
    await expect(
      migrateStorage(h.port, h.migration, { dryRun: false, checkpoint: paused }),
    ).rejects.toMatchObject({ code: "ERR_STORAGE_MIGRATION_FORMAT" });
    expect(h.rows.get(key)?.["version"]).toBe(88);
    expect(h.writes).toHaveLength(2);
  });
  it("detects count drift on a completed migration replay", async () => {
    const h = harness();
    const done = await migrateStorage(h.port, h.migration, { dryRun: false });
    h.rows.delete(JSON.stringify(["LEARNER#fixture", "a"]));
    await expect(
      migrateStorage(h.port, h.migration, { dryRun: false, checkpoint: done }),
    ).rejects.toMatchObject({ code: "ERR_STORAGE_MIGRATION_COUNT" });
  });
  it("refuses a checkpoint belonging to another table before any row write", async () => {
    const h = harness();
    const checkpoint = { ...initialCheckpoint(h.migration), target: "other" };
    await expect(
      migrateStorage(h.port, h.migration, { dryRun: false, checkpoint }),
    ).rejects.toBeInstanceOf(StorageMigrationError);
    expect(h.writes).toStrictEqual([]);
  });
  it("refuses a failed conditional replace and keeps the preceding checkpoint", async () => {
    const h = harness();
    await expect(
      migrateStorage(
        { ...h.port, replace: () => Promise.resolve(false) },
        h.migration,
        { dryRun: false },
      ),
    ).rejects.toMatchObject({ code: "ERR_STORAGE_MIGRATION_CONFLICT" });
    expect(h.saved.at(-1)).toMatchObject({ migrated: 0, pageOpen: true });
    expect(h.writes).toStrictEqual([]);
  });
  it("does not recount an all-current page after interruption before cursor advancement", async () => {
    const h = harness();
    await migrateStorage(h.port, h.migration, { dryRun: false });
    h.saved.length = 0;
    let stopped = false;
    await expect(
      migrateStorage(
        {
          ...h.port,
          save(state) {
            h.saved.push(structuredClone(state));
            if (!stopped) {
              stopped = true;
              return Promise.reject(new Error("fixture"));
            }
            return Promise.resolve();
          },
        },
        h.migration,
        { dryRun: false },
      ),
    ).rejects.toThrow(Error);
    const checkpoint = h.saved.at(-1);
    expect(checkpoint).toBeDefined();
    if (checkpoint === undefined) throw new Error("Missing fixture checkpoint");
    expect(checkpoint).toMatchObject({ seen: 2, unchanged: 2, pageOpen: true });
    expect(
      await migrateStorage(h.port, h.migration, { dryRun: false, checkpoint }),
    ).toMatchObject({ seen: 4, unchanged: 4, migrated: 0 });
  });
});
