import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
