import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeStorageRecord,
  encodeStorageValue,
  STORAGE_FAMILIES,
  STORAGE_SCHEMA_VERSION,
  StorageSchemaError,
  decodeReadModelBootstrapState,
  createDynamoDbReadModelBootstrapStorage,
  localDynamoDbClient,
} from "@instant-composition/adapters";
import { validateStoredRecords } from "@instant-composition/api";
import { parseJson, readKey, readString } from "../scripts/lib/json.mjs";

const data = parseJson(
  readFileSync(new URL("./fixtures/storage-v1.json", import.meta.url), "utf8"),
);
const cases = readKey(data, "fixtures");
if (!Array.isArray(cases)) throw new TypeError("Fixture inventory required.");
const fixtures = cases.map((fixture) => ({
  name: readString(fixture, "name"),
  row: readKey(fixture, "row"),
  expected: readKey(fixture, "expected"),
}));

describe("storage decoders and subsequent writes", () => {
  it("covers every persistent family, including identity", () => {
    expect(
      fixtures
        .slice(0, STORAGE_FAMILIES.length)
        .map((fixture) => readKey(fixture.row, "type")),
    ).toStrictEqual([...STORAGE_FAMILIES]);
  });
  it.each(fixtures)(
    "keeps supported values from legacy $name through the next guarded write",
    ({ row, expected }) => {
      const decoded = decodeStorageRecord(row);
      expect(decoded.value).toStrictEqual(expected);
      expect(decoded.version).toBe(readKey(row, "version"));
      expect(decoded.schemaVersion).toBe(0);
      const written = encodeStorageValue(decoded.type, decoded.value);
      const current = decodeStorageRecord({
        type: decoded.type,
        version: decoded.version + 1,
        schemaVersion: STORAGE_SCHEMA_VERSION,
        value: written,
      });
      expect(current.value).toStrictEqual(expected);
      expect(JSON.stringify(current.value)).not.toContain("answerMode");
      expect(JSON.stringify(current.value)).not.toContain("retired answer");
    },
  );
  it.each([undefined, 0, 1])(
    "rejects cap2 round checkpoints in a row declaring schema %s",
    (schemaVersion) => {
      const fixture = fixtures.find((item) => readKey(item.row, "type") === "round");
      if (!fixture) throw new TypeError("Round fixture required.");
      const expected = fixture.expected;
      if (typeof expected !== "object" || expected === null || Array.isArray(expected))
        throw new TypeError("Round value required.");
      const row = {
        type: "round",
        version: 1,
        ...(schemaVersion === undefined ? {} : { schemaVersion }),
        value: {
          ...expected,
          answerState: { firstCards: [], cursor: null, complete: true },
        },
      };
      const original = JSON.stringify(row);
      expect(() => decodeStorageRecord(row)).toThrow(StorageSchemaError);
      expect(validateStoredRecords([row])).toMatchObject({
        ok: false,
        code: "ERR_STORAGE_SHAPE",
      });
      expect(JSON.stringify(row)).toBe(original);
    },
  );
  it.each([
    null,
    [],
    "value",
    {},
    { type: "settings", version: 1, value: {} },
    { type: "settings", version: 0, value: {} },
    { type: "settings", version: 1.5, value: {} },
    { type: "settings", version: Infinity, value: {} },
  ])("rejects malformed stored shape %j", (row) => {
    expect(() => decodeStorageRecord(row)).toThrow(StorageSchemaError);
  });
  it.each([STORAGE_SCHEMA_VERSION + 1, -1, 0.5, Number.MAX_SAFE_INTEGER])(
    "fails closed on schema %s",
    (schemaVersion) => {
      const fixture = fixtures[2];
      expect(() =>
        decodeStorageRecord({ ...(fixture?.row as object), schemaVersion }),
      ).toThrow(StorageSchemaError);
    },
  );
  it("rejects a future field on a current schema instead of dropping it on a write", () => {
    const fixture = fixtures[8];
    const row = fixture?.row as Record<string, unknown>;
    const next = {
      ...row,
      schemaVersion: STORAGE_SCHEMA_VERSION,
      value: { ...(fixture?.expected as object), futureRequired: "must survive" },
    };
    expect(() => decodeStorageRecord(next)).toThrow(StorageSchemaError);
    expect(() => encodeStorageValue("item", next.value)).toThrow(StorageSchemaError);
    expect(next.value.futureRequired).toBe("must survive");
  });
  it("validates nested schedules, enums and required fields", () => {
    const fixture = fixtures[8];
    const row = fixture?.row as Record<string, unknown>;
    expect(() =>
      decodeStorageRecord({
        ...row,
        value: { ...(fixture?.expected as object), fsrs: { stability: "broken" } },
      }),
    ).toThrow(StorageSchemaError);
    expect(() =>
      decodeStorageRecord({ ...row, type: "talk", value: fixture?.expected }),
    ).toThrow(StorageSchemaError);
  });
  it.each([0, 1])("refuses unknown envelope metadata on schema %s", (schemaVersion) => {
    expect(() =>
      decodeStorageRecord({
        ...(fixtures[3]?.row as object),
        schemaVersion,
        futurePersistedMetadata: "retain",
      }),
    ).toThrow(StorageSchemaError);
  });
  it("refuses arbitrary legacy fields at every depth instead of certifying their deletion", () => {
    const stats = {
      ...(fixtures[3]?.expected as object),
      futurePersistedField: "retain",
    };
    const item = fixtures[8]?.expected;
    const fsrs = readKey(item, "fsrs");
    for (const row of [
      { ...(fixtures[3]?.row as object), value: stats },
      {
        ...(fixtures[8]?.row as object),
        value: {
          ...(item as object),
          fsrs: { ...(fsrs as object), futureField: "retain" },
        },
      },
      {
        ...(fixtures[2]?.row as object),
        value: { ...(fixtures[2]?.expected as object), unpublished: "retain" },
      },
    ])
      expect(() => decodeStorageRecord(row)).toThrow(StorageSchemaError);
    expect(stats.futurePersistedField).toBe("retain");
  });
  it.each([
    {
      type: "settings",
      value: { ...(fixtures[2]?.expected as object), answerMode: "future" },
    },
    {
      type: "review",
      value: {
        ...(fixtures[5]?.expected as object),
        detail: {
          ...(readKey(fixtures[5]?.expected, "detail") as object),
          text: { future: true },
        },
      },
    },
    {
      type: "item",
      value: {
        ...(fixtures[8]?.expected as object),
        otherMode: {
          sessionId: "r",
          result: "ok",
          elapsedMs: 1,
          answeredAt: 1,
          futureField: "retain",
        },
      },
    },
  ])("validates retired fields before discarding $type", (entry) => {
    expect(() => decodeStorageRecord({ ...entry, version: 1 })).toThrow(
      StorageSchemaError,
    );
  });
  it.each([-1, 0.5, "later", Infinity])(
    "refuses malformed transport expiry %s",
    (expiresAt) => {
      expect(() =>
        decodeStorageRecord({ ...(fixtures[9]?.row as object), expiresAt }),
      ).toThrow(StorageSchemaError);
    },
  );
  it("accepts only transport expiry matching a declared expiring value", () => {
    const row = fixtures[9]?.row as object;
    const expiresAt = readKey(fixtures[9]?.expected, "expiresAt");
    expect(() =>
      decodeStorageRecord({ ...row, PK: "LEARNER#fixture", SK: "TALK#t1", expiresAt }),
    ).not.toThrow();
    expect(() => decodeStorageRecord({ ...row, expiresAt: 1 })).toThrow(
      StorageSchemaError,
    );
    expect(() =>
      decodeStorageRecord({ ...(fixtures[2]?.row as object), expiresAt: 1 }),
    ).toThrow(StorageSchemaError);
  });
  it("maintenance returns fixed failure codes without stored learner content", () => {
    const answer = validateStoredRecords([
      {
        type: "talk",
        version: 1,
        schemaVersion: STORAGE_SCHEMA_VERSION + 1,
        value: { english: "private fixture text" },
      },
    ]);
    expect(answer).toStrictEqual({ ok: false, code: "ERR_STORAGE_SCHEMA_UNKNOWN" });
    expect(validateStoredRecords("invalid")).toStrictEqual({
      ok: false,
      code: "ERR_STORAGE_SHAPE",
    });
  });
});

const reserved = readKey(data, "reservedFutureFixtures");
if (!Array.isArray(reserved)) throw new TypeError("Future fixtures required.");
it.each(
  reserved.filter(
    (fixture) =>
      Number(readKey(readKey(fixture, "row"), "schemaVersion")) >
      STORAGE_SCHEMA_VERSION,
  ),
)("initial guard refuses future expansion $name before any next write", (fixture) => {
  expect(() => decodeStorageRecord(readKey(fixture, "row"))).toThrow(
    StorageSchemaError,
  );
});
it.each([STORAGE_SCHEMA_VERSION + 1, STORAGE_SCHEMA_VERSION + 2])(
  "initial guard refuses storage generation %s even for a known family",
  (schemaVersion) => {
    expect(() =>
      decodeStorageRecord({ ...(fixtures[2]?.row as object), schemaVersion }),
    ).toThrow(StorageSchemaError);
  },
);
it("admits the reviewed round checkpoint expansion and keeps compact stats inactive", () => {
  const round = {
    ...(fixtures[4]?.expected as object),
    answerState: { firstCards: [], cursor: null, complete: true },
  };
  expect(encodeStorageValue("round", round)).toStrictEqual(round);
  expect(() =>
    encodeStorageValue("stats", {
      ...(fixtures[3]?.expected as object),
      streak: { schema: 1, longest: 3 },
    }),
  ).toThrow(StorageSchemaError);
});
it("prepares a strictly bound future durable checkpoint without admitting the family to cap1", async () => {
  const checkpoint = {
    schema: 1,
    phase: "discovery",
    catalog: "fixture-catalog",
    cursor: null,
    validUntil: null,
  };
  const value = {
    schema: 1,
    release: {
      sha: "a".repeat(40),
      contract: "fixture-v4",
      schemaFingerprint: "b".repeat(64),
    },
    catalog: "fixture-catalog",
    checkpoint: JSON.stringify(checkpoint),
    validUntil: null,
    maintenanceVersion: null,
    complete: false,
    phase: "discovery",
    rows: 100,
    learners: 3,
  };
  expect(decodeReadModelBootstrapState(value)).toStrictEqual(value);
  for (const invalid of [
    { ...value, future: true },
    { ...value, release: { ...value.release, future: true } },
    { ...value, checkpoint: JSON.stringify({ ...checkpoint, future: true }) },
    { ...value, catalog: "different" },
    { ...value, validUntil: 1234 },
    { ...value, maintenanceVersion: 0 },
    { ...value, checkpoint: "x".repeat(8193) },
    { ...value, complete: true },
  ])
    expect(() => decodeReadModelBootstrapState(invalid)).toThrow(StorageSchemaError);
  expect(() =>
    decodeStorageRecord({
      type: "readModelBootstrap",
      version: 1,
      schemaVersion: 4,
      value,
    }),
  ).toThrow(StorageSchemaError);
  const client = localDynamoDbClient("http://127.0.0.1:1");
  try {
    const port = createDynamoDbReadModelBootstrapStorage({
      client,
      tableName: "unused",
    });
    await expect(port.checkpoint()).rejects.toMatchObject({
      code: "ERR_STORAGE_SCHEMA_UNKNOWN",
    });
    await expect(
      port.save(decodeReadModelBootstrapState(value), null),
    ).rejects.toMatchObject({ code: "ERR_STORAGE_SCHEMA_UNKNOWN" });
  } finally {
    client.destroy();
  }
});

it("preserves every cap2 checkpoint and guarded-v1 row through the actual maintenance next write", () => {
  const document = parseJson(
    readFileSync(new URL("./fixtures/storage-v2.json", import.meta.url), "utf8"),
  );
  const rows = readKey(document, "fixtures");
  if (!Array.isArray(rows)) throw new TypeError("Cap2 fixtures required.");
  for (const fixture of rows) {
    const result = validateStoredRecords([readKey(fixture, "row")]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new TypeError("Supported fixture refused.");
    expect(readKey(result.rows[0], "targetSchema")).toBe(STORAGE_SCHEMA_VERSION);
    expect(readKey(result.rows[0], "targetValue")).toStrictEqual(
      readKey(fixture, "expected"),
    );
  }
});
