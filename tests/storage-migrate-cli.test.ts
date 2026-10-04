import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StorageCompatibilityError } from "../scripts/lib/storage-compatibility.mjs";
import { main } from "../scripts/storage-migrate.mjs";
import {
  checkpointOf,
  readCheckpoint,
  saveCheckpoint,
} from "../scripts/lib/storage-checkpoint.mjs";
import { createStorageValidator } from "../scripts/lib/storage-validator.mjs";
import { StorageMigrationError } from "../scripts/lib/storage-migration.mjs";
import { parseJson, readKey } from "../scripts/lib/json.mjs";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storage-checkpoint-"));
  temporary.push(dir);
  return dir;
}

describe("storage maintenance operator", () => {
  it.each(
    [
      [],
      ["--table", "prod-table", "--checkpoint", "fixture.json"],
      [
        "--table",
        "fixture",
        "--endpoint",
        "https://example.com",
        "--checkpoint",
        "fixture.json",
      ],
      [
        "--table",
        "fixture",
        "--endpoint",
        "http://127.0.0.1:8000",
        "--checkpoint",
        "fixture.json",
        "--apply",
      ],
      [
        "--table",
        "fixture",
        "--endpoint",
        "http://127.0.0.1:8000",
        "--checkpoint",
        ".env.local",
      ],
    ].map((args) => ({ args })),
  )(
    "refuses unsafe or incomplete operator arguments before data access %j",
    async ({ args }) => {
      await expect(main(args)).rejects.toBeInstanceOf(StorageMigrationError);
    },
  );
  it("never retargets the archived v1 default plan to a newer writer", async () => {
    const checkpoint = path.join(folder(), "legacy.json");
    await expect(
      main([
        "--table",
        "fixture",
        "--endpoint",
        "http://127.0.0.1:1",
        "--checkpoint",
        checkpoint,
      ]),
    ).rejects.toBeInstanceOf(StorageCompatibilityError);
    expect(existsSync(checkpoint)).toBe(false);
    expect(existsSync(`${checkpoint}.lock`)).toBe(false);
  });
  it.each(
    ["legacy-to-storage-v1", "expand-to-storage-v2", "expand-to-storage-v3"].flatMap(
      (plan) => ["dry-run", "apply", "resume"].map((mode) => ({ plan, mode })),
    ),
  )(
    "refuses archived $plan in $mode before creating child, lock or checkpoint",
    async ({ plan, mode }) => {
      const checkpoint = path.join(folder(), "archived.json");
      await expect(
        main([
          "--plan",
          plan,
          "--table",
          "fixture",
          "--endpoint",
          "http://127.0.0.1:1",
          "--checkpoint",
          checkpoint,
          ...(mode === "dry-run" ? ["--dry-run"] : ["--apply", "--writers-stopped"]),
          ...(mode === "resume" ? ["--resume"] : []),
        ]),
      ).rejects.toMatchObject({ code: "ERR_STORAGE_RELEASE_UNSAFE" });
      expect(existsSync(checkpoint)).toBe(false);
      expect(existsSync(`${checkpoint}.lock`)).toBe(false);
    },
  );
  it("admits only the explicit v4 expansion before attempting data access", async () => {
    const checkpoint = path.join(folder(), "v4.json");
    await expect(
      main([
        "--plan",
        "expand-to-storage-v4",
        "--table",
        "fixture",
        "--endpoint",
        "http://127.0.0.1:1",
        "--checkpoint",
        checkpoint,
      ]),
    ).rejects.toThrow("ERR_STORAGE_VALIDATOR_REFUSED");
    expect(existsSync(checkpoint)).toBe(false);
  });
  it("refuses an unreviewed plan before opening a checkpoint or making a request", async () => {
    const checkpoint = path.join(folder(), "future.json");
    await expect(
      main([
        "--plan",
        "automatic-current-schema",
        "--table",
        "fixture",
        "--endpoint",
        "http://127.0.0.1:1",
        "--checkpoint",
        checkpoint,
      ]),
    ).rejects.toBeInstanceOf(StorageMigrationError);
    expect(existsSync(checkpoint)).toBe(false);
  });
  it("atomically records only keys, digests and counters, and reloads the checkpoint", () => {
    const file = path.join(folder(), "checkpoint.json");
    const checkpoint = {
      migration: "fixture-v2",
      target: "fixture-table",
      targetSchema: 2,
      cursor: null,
      nextCursor: null,
      seen: 1,
      migrated: 0,
      unchanged: 0,
      pending: [
        {
          key: '["LEARNER#fixture","PROFILE"]',
          version: 4,
          sourceSchema: 1,
          digest: "a".repeat(64),
          done: false,
        },
      ],
      pageOpen: true,
      complete: false,
    };
    saveCheckpoint(file, checkpoint);
    expect(readCheckpoint(file)).toStrictEqual(checkpoint);
    expect(existsSync(`${file}.next`)).toBe(false);
    expect(readFileSync(file, "utf8")).not.toContain("private learner content");
  });
  it.each([
    {},
    null,
    { migration: "fixture", target: "table", pending: [], complete: true },
  ])("rejects malformed checkpoint %j", (checkpoint) => {
    expect(() => checkpointOf(checkpoint)).toThrow(StorageMigrationError);
  });
  it("validates real fixtures through the private maintenance process and returns no learner data on failure", async () => {
    const validator = createStorageValidator();
    try {
      const data = parseJson(
        readFileSync(new URL("./fixtures/storage-v1.json", import.meta.url), "utf8"),
      );
      const fixtures = readKey(data, "fixtures");
      if (!Array.isArray(fixtures)) throw new TypeError("Fixture inventory required.");
      const answer = await validator.request(
        fixtures.map((fixture) => readKey(fixture, "row")),
      );
      expect(readKey(answer, "rows")).toHaveLength(fixtures.length);
      await expect(
        validator.request([
          {
            type: "settings",
            version: 1,
            schemaVersion: 99,
            value: { private: "private learner content" },
          },
        ]),
      ).rejects.toThrow(Error);
      // A refused page does not leave the private maintenance stream unusable.
      expect(readKey(await validator.request([]), "rows")).toStrictEqual([]);
      const large = "日本語".repeat(100_000);
      const task: unknown = fixtures.find(
        (fixture) => readKey(readKey(fixture, "row"), "type") === "talk",
      );
      const row = readKey(task, "row");
      const value = readKey(row, "value");
      if (
        typeof row !== "object" ||
        row === null ||
        typeof value !== "object" ||
        value === null
      )
        throw new TypeError("Talk fixture required.");
      const result = readKey(value, "scene");
      if (typeof result !== "object" || result === null)
        throw new TypeError("Scene fixture required.");
      const unicode = await validator.request([
        { ...row, value: { ...value, scene: { ...result, description: large } } },
      ]);
      const records = readKey(unicode, "rows");
      if (!Array.isArray(records)) throw new TypeError("Decoded rows required.");
      expect(
        readKey(readKey(readKey(records[0], "targetValue"), "scene"), "description"),
      ).toBe(large);
    } finally {
      await validator.close();
    }
  });
});
