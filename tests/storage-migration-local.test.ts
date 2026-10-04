import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
  createDynamoDbStores,
  StorageSchemaError,
  STORAGE_SCHEMA_VERSION,
} from "@instant-composition/adapters";
import { learnerId, keyOf, type Entry } from "@instant-composition/application";
import { main } from "../scripts/storage-migrate.mjs";
import {
  makeItem,
  makeRound,
  makeSettings,
  makeStats,
  makeTalk,
} from "./application-fixtures";
import { parseJson, readKey } from "../scripts/lib/json.mjs";

const endpoint = "http://127.0.0.1:8000";
function wire(value: unknown): unknown {
  if (value === null) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(wire) };
  return {
    M: Object.fromEntries(
      Object.entries(value as object).map(([key, field]) => [key, wire(field)]),
    ),
  };
}
async function dynamo(operation: string, body: unknown): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.0",
      "x-amz-target": `DynamoDB_20120810.${operation}`,
      "x-amz-date": "20261003T000000Z",
      authorization:
        "AWS4-HMAC-SHA256 Credential=local/20261003/local/dynamodb/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=" +
        "0".repeat(64),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Owned local fixture request failed.");
  return (await response.json()) as unknown;
}

describe("guarded storage on DynamoDB local", () => {
  it.each(["stats", "fsrs", "envelope"])(
    "refuses unknown unversioned %s data before dry-run, migration, update or delete",
    async (kind) => {
      const table = `storage437-${randomUUID()}`,
        client = localDynamoDbClient(endpoint);
      const folder = mkdtempSync(path.join(tmpdir(), "storage437-unknown-"));
      const checkpoint = path.join(folder, "checkpoint.json");
      await createLearnerTable(client, table);
      try {
        const entry: Entry =
          kind === "fsrs"
            ? { type: "item", value: makeItem() }
            : { type: "stats", value: makeStats() };
        const key = {
          PK: "LEARNER#fixture",
          SK: kind === "fsrs" ? "ITEM#composition#c1" : "STATS",
        };
        const row = {
          ...key,
          ...entry,
          version: 7,
          value:
            kind === "stats"
              ? { ...makeStats(), futurePersistedField: "retain" }
              : kind === "fsrs"
                ? { ...makeItem(), fsrs: { ...makeItem().fsrs, futureField: "retain" } }
                : entry.value,
          ...(kind === "envelope" ? { futurePersistedMetadata: "retain" } : {}),
        };
        await dynamo("PutItem", { TableName: table, Item: readKey(wire(row), "M") });
        const get = () =>
          dynamo("GetItem", { TableName: table, Key: readKey(wire(key), "M") });
        const before = await get();
        const sibling = {
          PK: "LEARNER#valid-sibling",
          SK: "SETTINGS",
          type: "settings",
          version: 1,
          schemaVersion: 2,
          value: makeSettings(),
        };
        await dynamo("PutItem", {
          TableName: table,
          Item: readKey(wire(sibling), "M"),
        });
        const getSibling = () =>
          dynamo("GetItem", {
            TableName: table,
            Key: readKey(wire({ PK: sibling.PK, SK: sibling.SK }), "M"),
          });
        const siblingBefore = await getSibling();
        const args = [
          "--plan",
          "expand-to-storage-v4",
          "--table",
          table,
          "--endpoint",
          endpoint,
          "--checkpoint",
          checkpoint,
        ];
        await expect(main([...args, "--dry-run"])).rejects.toThrow(
          "ERR_STORAGE_VALIDATOR_REFUSED",
        );
        await expect(main([...args, "--apply", "--writers-stopped"])).rejects.toThrow(
          "ERR_STORAGE_VALIDATOR_REFUSED",
        );
        expect(existsSync(checkpoint)).toBe(false);
        expect(existsSync(`${checkpoint}.lock`)).toBe(false);
        const store = createDynamoDbStores({ client, tableName: table }).forLearner(
          learnerId("fixture"),
        );
        await expect(
          kind === "fsrs" ? store.items() : store.stats(),
        ).rejects.toBeInstanceOf(StorageSchemaError);
        await expect(
          store.commit({ puts: [], updates: [{ entry, version: 7 }], expect: [] }),
        ).rejects.toBeInstanceOf(StorageSchemaError);
        await expect(
          store.commit({
            puts: [],
            updates: [],
            expect: [],
            deletes: [{ key: keyOf(entry), version: 7 }],
          }),
        ).rejects.toBeInstanceOf(StorageSchemaError);
        expect(await get()).toStrictEqual(before);
        expect(await getSibling()).toStrictEqual(siblingBefore);
      } finally {
        await deleteLearnerTable(client, table);
        client.destroy();
        rmSync(folder, { recursive: true, force: true });
      }
    },
  );
  it("explicitly expands legacy and guarded-v1 rows once, preserving fields and retiring typed data", async () => {
    const table = `storage437-${randomUUID()}`,
      client = localDynamoDbClient(endpoint);
    const folder = mkdtempSync(path.join(tmpdir(), "storage437-migrate-")),
      checkpoint = path.join(folder, "checkpoint.json");
    await createLearnerTable(client, table);
    try {
      await dynamo("PutItem", {
        TableName: table,
        Item: readKey(
          wire({
            PK: "LEARNER#fixture-a",
            SK: "SETTINGS",
            type: "settings",
            version: 8,
            value: {
              ...makeSettings({ gradeKeys: { ok: "KeyJ", ng: "KeyF", hard: "KeyK" } }),
              answerMode: "typed",
            },
          }),
          "M",
        ),
      });
      await dynamo("PutItem", {
        TableName: table,
        Item: readKey(
          wire({
            PK: "LEARNER#fixture-b",
            SK: "ITEM#composition#c1",
            type: "item",
            version: 3,
            schemaVersion: 1,
            value: makeItem({ revision: 7 }),
          }),
          "M",
        ),
      });
      const args = [
        "--plan",
        "expand-to-storage-v4",
        "--table",
        table,
        "--endpoint",
        endpoint,
        "--checkpoint",
        checkpoint,
      ];
      expect(await main([...args, "--dry-run"])).toMatchObject({
        complete: true,
        seen: 2,
        migrated: 2,
      });
      expect(existsSync(checkpoint)).toBe(false);
      expect(existsSync(`${checkpoint}.lock`)).toBe(false);
      const raw = await dynamo("GetItem", {
        TableName: table,
        Key: { PK: { S: "LEARNER#fixture-a" }, SK: { S: "SETTINGS" } },
      });
      expect(readKey(readKey(raw, "Item"), "schemaVersion")).toBeUndefined();
      const complete = await main([...args, "--apply", "--writers-stopped"]);
      expect(complete).toMatchObject({ complete: true, seen: 2, migrated: 2 });
      expect(
        await main([...args, "--apply", "--writers-stopped", "--resume"]),
      ).toStrictEqual(complete);
      const store = createDynamoDbStores({ client, tableName: table });
      expect(await store.forLearner(learnerId("fixture-a")).settings()).toStrictEqual({
        version: 9,
        value: makeSettings({ gradeKeys: { ok: "KeyJ", ng: "KeyF", hard: "KeyK" } }),
      });
      expect(
        (await store.forLearner(learnerId("fixture-b")).items()).get("c1"),
      ).toStrictEqual({ version: 4, value: makeItem({ revision: 7 }) });
      expect(await store.forLearner(learnerId("fixture-a")).items()).toStrictEqual(
        new Map(),
      );
      expect(readFileSync(checkpoint, "utf8")).not.toContain("gradeKeys");
    } finally {
      await deleteLearnerTable(client, table);
      client.destroy();
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it("resumes the v4 expansion preserving signed marks, answer state and exact TTL presence", async () => {
    const table = `storage436-${randomUUID()}`,
      client = localDynamoDbClient(endpoint);
    const folder = mkdtempSync(path.join(tmpdir(), "storage436-v3-"));
    const checkpoint = path.join(folder, "checkpoint.json");
    const fixture = parseJson(
      readFileSync(new URL("./fixtures/storage-v3.json", import.meta.url), "utf8"),
    );
    const fixtures = readKey(fixture, "fixtures");
    if (!Array.isArray(fixtures)) throw new TypeError("Fixture inventory required.");
    const task = readKey(
      fixtures.find(
        (entry) =>
          readKey(entry, "name") === "model-task-result-scene-generation-absent",
      ),
      "row",
    );
    if (typeof task !== "object" || task === null)
      throw new TypeError("Complete task required.");
    const rows: Record<string, unknown>[] = [];
    for (const schema of [0, 1, 2]) {
      rows.push({
        PK: `LEARNER#round-${String(schema)}`,
        SK: "ROUND#r1",
        type: "round",
        version: 7,
        ...(schema === 0 ? {} : { schemaVersion: schema }),
        value: makeRound(
          schema === 2
            ? {
                firstPass: 1,
                answerState: {
                  firstCards: ["c1"],
                  cursor: "answer-1",
                  complete: false,
                },
              }
            : {},
        ),
      });
      const original = makeItem().last;
      if (original === null) throw new TypeError("Signed mark fixture required.");
      const last = { ...original, answeredAt: -1 };
      rows.push({
        PK: `LEARNER#item-${String(schema)}`,
        SK: "ITEM#composition#c1",
        type: "item",
        version: 4,
        ...(schema === 0 ? {} : { schemaVersion: schema }),
        value: makeItem({ last, previous: { ...last, answeredAt: -0.5 } }),
      });
      for (const mirror of [false, true])
        rows.push({
          PK: `LEARNER#talk-${String(schema)}-${String(mirror)}`,
          SK: "TALK#t1",
          type: "talk",
          version: 3,
          ...(schema === 0 ? {} : { schemaVersion: schema }),
          value: makeTalk(),
          ...(mirror ? { expiresAt: makeTalk().expiresAt } : {}),
        });
    }
    for (const schemaVersion of [3, 4]) {
      for (const mirror of [false, true]) {
        const row: Record<string, unknown> = {
          ...task,
          schemaVersion,
          PK: `LEARNER#task-${String(schemaVersion)}-${String(mirror)}`,
        };
        if (!mirror) delete row["expiresAt"];
        rows.push(row);
      }
    }
    // Force a bounded first page so resume must process a later source page.
    for (let index = rows.length; index < 101; index += 1)
      rows.push({
        PK: `LEARNER#padding-${String(index)}`,
        SK: "SETTINGS",
        type: "settings",
        version: 1,
        schemaVersion: index % 4,
        value: makeSettings(),
      });
    await createLearnerTable(client, table);
    try {
      const get = (row: Record<string, unknown>) =>
        dynamo("GetItem", {
          TableName: table,
          Key: readKey(wire({ PK: row["PK"], SK: row["SK"] }), "M"),
        });
      for (const row of rows)
        await dynamo("PutItem", { TableName: table, Item: readKey(wire(row), "M") });
      const before = await Promise.all(rows.map(get));
      const args = [
        "--plan",
        "expand-to-storage-v4",
        "--table",
        table,
        "--endpoint",
        endpoint,
        "--checkpoint",
        checkpoint,
      ];
      expect(await main([...args, "--dry-run"])).toMatchObject({
        complete: true,
        seen: 101,
        migrated: 99,
        unchanged: 2,
      });
      expect(await Promise.all(rows.map(get))).toStrictEqual(before);
      expect(existsSync(checkpoint)).toBe(false);
      const partial = await main([
        ...args,
        "--apply",
        "--writers-stopped",
        "--max-pages",
        "1",
      ]);
      expect(partial.complete).toBe(false);
      expect(partial.seen).toBe(100);
      const complete = await main([
        ...args,
        "--apply",
        "--writers-stopped",
        "--resume",
      ]);
      expect(complete).toMatchObject({
        complete: true,
        seen: 101,
        migrated: 99,
        unchanged: 2,
        migration: "expand-to-storage-v4",
        targetSchema: 4,
      });
      expect(
        await main([...args, "--apply", "--writers-stopped", "--resume"]),
      ).toStrictEqual(complete);
      for (const [index, row] of rows.entries()) {
        const after = await get(row);
        if (row["schemaVersion"] === 4) expect(after).toStrictEqual(before[index]);
        else
          expect(readKey(after, "Item")).toStrictEqual(
            readKey(
              wire({
                ...row,
                schemaVersion: 4,
                version: Number(row["version"]) + 1,
              }),
              "M",
            ),
          );
      }
      const wrong = { ...complete, migration: "expand-to-storage-v2", targetSchema: 2 };
      const { saveCheckpoint } = await import("../scripts/lib/storage-checkpoint.mjs");
      saveCheckpoint(checkpoint, wrong);
      const stable = await Promise.all(rows.map(get));
      await expect(
        main([...args, "--apply", "--writers-stopped", "--resume"]),
      ).rejects.toThrow("ERR_STORAGE_MIGRATION_FORMAT");
      expect(await Promise.all(rows.map(get))).toStrictEqual(stable);
      expect(existsSync(`${checkpoint}.lock`)).toBe(false);
    } finally {
      await deleteLearnerTable(client, table);
      client.destroy();
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it("blocks a stale writer from updates and deletions of a future schema", async () => {
    const table = `storage437-${randomUUID()}`,
      client = localDynamoDbClient(endpoint);
    await createLearnerTable(client, table);
    try {
      const value = { ...makeSettings(), futureRequired: "retained by new writer" };
      await dynamo("PutItem", {
        TableName: table,
        Item: readKey(
          wire({
            PK: "LEARNER#fixture",
            SK: "SETTINGS",
            type: "settings",
            version: 5,
            schemaVersion: STORAGE_SCHEMA_VERSION + 1,
            value,
          }),
          "M",
        ),
      });
      const store = createDynamoDbStores({ client, tableName: table }).forLearner(
        learnerId("fixture"),
      );
      await expect(store.settings()).rejects.toBeInstanceOf(StorageSchemaError);
      expect(
        await store.commit({
          puts: [],
          updates: [{ entry: { type: "settings", value: makeSettings() }, version: 5 }],
          expect: [],
        }),
      ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      expect(
        await store.commit({
          puts: [],
          updates: [],
          expect: [],
          deletes: [{ key: { type: "settings" }, version: 5 }],
        }),
      ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      const raw = await dynamo("GetItem", {
        TableName: table,
        Key: { PK: { S: "LEARNER#fixture" }, SK: { S: "SETTINGS" } },
      });
      expect(readKey(readKey(raw, "Item"), "version")).toStrictEqual({ N: "5" });
      expect(
        readKey(readKey(readKey(readKey(raw, "Item"), "value"), "M"), "futureRequired"),
      ).toStrictEqual({ S: "retained by new writer" });
    } finally {
      await deleteLearnerTable(client, table);
      client.destroy();
    }
  });
  it("preserves future-schema checkpoints and compact streaks before a supported writer can replace or delete them", async () => {
    const table = `storage437-${randomUUID()}`,
      client = localDynamoDbClient(endpoint);
    await createLearnerTable(client, table);
    try {
      const rows = [
        {
          SK: "ROUND#r1",
          type: "round",
          schemaVersion: STORAGE_SCHEMA_VERSION + 1,
          value: {
            ...makeRound(),
            answerState: { firstCards: ["c1"], cursor: "a1", complete: false },
          },
        },
        {
          SK: "STATS",
          type: "stats",
          schemaVersion: STORAGE_SCHEMA_VERSION + 1,
          value: {
            ...Object.fromEntries(
              Object.entries(makeStats()).filter(([key]) => key !== "completedDays"),
            ),
            streak: { schema: 1, longest: 17 },
          },
        },
      ];
      for (const row of rows)
        await dynamo("PutItem", {
          TableName: table,
          Item: readKey(wire({ PK: "LEARNER#fixture", version: 7, ...row }), "M"),
        });
      const store = createDynamoDbStores({ client, tableName: table }).forLearner(
        learnerId("fixture"),
      );
      await expect(store.round("r1")).rejects.toBeInstanceOf(StorageSchemaError);
      await expect(store.stats()).rejects.toBeInstanceOf(StorageSchemaError);
      for (const entry of [
        { type: "round", value: makeRound() },
        { type: "stats", value: makeStats() },
      ] as const) {
        expect(
          await store.commit({
            puts: [],
            updates: [{ entry, version: 7 }],
            expect: [],
          }),
        ).toEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      }
      for (const key of [{ type: "round", id: "r1" }, { type: "stats" }] as const) {
        expect(
          await store.commit({
            puts: [],
            updates: [],
            expect: [],
            deletes: [{ key, version: 7 }],
          }),
        ).toEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      }
      for (const row of rows) {
        const actual = await dynamo("GetItem", {
          TableName: table,
          Key: { PK: { S: "LEARNER#fixture" }, SK: { S: row.SK } },
        });
        expect(readKey(actual, "Item")).toEqual(
          readKey(wire({ PK: "LEARNER#fixture", version: 7, ...row }), "M"),
        );
      }
    } finally {
      await deleteLearnerTable(client, table);
      client.destroy();
    }
  });
});
