import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeStorageRecord,
  encodeStorageValue,
  STORAGE_FAMILIES,
  STORAGE_SCHEMA_VERSION,
  StorageSchemaError,
  decodeReadModelBootstrapState,
} from "@instant-composition/adapters";
import { validateStoredRecords } from "@instant-composition/api";
import { parseJson, readKey, readString } from "../scripts/lib/json.mjs";
import { makeItem } from "./application-fixtures";

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

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Object fixture required.");
  return value as Record<string, unknown>;
}

const cap3Rows = readKey(
  parseJson(
    readFileSync(new URL("./fixtures/storage-v3.json", import.meta.url), "utf8"),
  ),
  "fixtures",
);
if (!Array.isArray(cap3Rows)) throw new TypeError("Cap3 fixtures required.");
const cap3: readonly unknown[] = cap3Rows;
const taskFixtures = cap3.filter(
  (fixture) => readKey(readKey(fixture, "row"), "type") === "modelTask",
);
function taskFixture(state: string) {
  const fixture = taskFixtures.find(
    (entry) => readKey(readKey(readKey(entry, "row"), "value"), "state") === state,
  );
  if (fixture === undefined) throw new TypeError("Task fixture required.");
  return record(readKey(fixture, "row"));
}

describe("schema3 model task history", () => {
  it("covers all cap3 families and keeps all cap2 values plus complete task outcomes through the maintenance next write", () => {
    expect(
      new Set(cap3.map((fixture) => readKey(readKey(fixture, "row"), "type"))),
    ).toStrictEqual(new Set(STORAGE_FAMILIES.slice(0, 15)));
    expect(cap3).toHaveLength(30);
    expect(taskFixtures).toHaveLength(8);
    for (const fixture of cap3) {
      const row = readKey(fixture, "row");
      const original = JSON.stringify(row);
      const result = validateStoredRecords([row]);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new TypeError("Supported fixture refused.");
      expect(readKey(result.rows[0], "targetSchema")).toBe(STORAGE_SCHEMA_VERSION);
      expect(readKey(result.rows[0], "targetValue")).toStrictEqual(
        readKey(fixture, "expected"),
      );
      expect(JSON.stringify(row)).toBe(original);
    }
  });

  it.each([undefined, 0, 1, 2, STORAGE_SCHEMA_VERSION + 1])(
    "refuses tasks outside their birth/current schema %s",
    (schemaVersion) => {
      const { schemaVersion: ignored, ...row } = taskFixture("in-flight");
      expect(ignored).toBe(3);
      expect(() =>
        decodeStorageRecord({
          ...row,
          ...(schemaVersion === undefined ? {} : { schemaVersion }),
        }),
      ).toThrow(StorageSchemaError);
      expect(
        validateStoredRecords([
          { ...row, ...(schemaVersion === undefined ? {} : { schemaVersion }) },
        ]),
      ).toMatchObject({ ok: false, code: "ERR_STORAGE_SCHEMA_UNKNOWN" });
    },
  );

  it("retains zero leases, absent generation, explicit zero generation, and expired tasks without rewriting them", () => {
    const absent = taskFixture("in-flight");
    const value = record(absent["value"]);
    const key = record(value["key"]);
    expect(value["leaseUntil"]).toBe(0);
    expect(key).not.toHaveProperty("generation");
    expect(decodeStorageRecord(absent).value).toStrictEqual(value);
    const sortKey = readString(absent, "SK");
    if (sortKey === undefined) throw new TypeError("Task sort key required.");
    const zero = {
      ...absent,
      SK: `${sortKey}#0`,
      value: { ...value, key: { ...key, generation: 0 } },
    };
    expect(decodeStorageRecord(zero).value).toStrictEqual(zero.value);
    expect(() => decodeStorageRecord({ ...zero, SK: absent["SK"] })).toThrow(
      StorageSchemaError,
    );
    expect(() => decodeStorageRecord({ ...absent, SK: zero.SK })).toThrow(
      StorageSchemaError,
    );
  });

  it.each(["result", "failed"])(
    "refuses a retained lease on %s rather than silently stripping it",
    (state) => {
      const row = taskFixture(state);
      const value = { ...record(row["value"]), leaseUntil: 0 };
      expect(() => decodeStorageRecord({ ...row, value })).toThrow(StorageSchemaError);
      expect(() => encodeStorageValue("modelTask", value)).toThrow(StorageSchemaError);
      expect(value.leaseUntil).toBe(0);
    },
  );

  it.each([undefined, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "refuses missing/invalid in-flight lease %s",
    (leaseUntil) => {
      const row = taskFixture("in-flight");
      const { leaseUntil: ignored, ...identity } = record(row["value"]);
      expect(ignored).toBe(0);
      expect(() =>
        decodeStorageRecord({
          ...row,
          value: { ...identity, ...(leaseUntil === undefined ? {} : { leaseUntil }) },
        }),
      ).toThrow(StorageSchemaError);
    },
  );

  it.each(taskFixtures)("rejects undeclared task fields in $name", (fixture) => {
    const row = record(readKey(fixture, "row"));
    const value = record(row["value"]);
    expect(() =>
      decodeStorageRecord({ ...row, value: { ...value, future: true } }),
    ).toThrow(StorageSchemaError);
  });

  it.each(
    taskFixtures.filter(
      (fixture) =>
        readKey(readKey(readKey(fixture, "row"), "value"), "state") === "result",
    ),
  )("rejects incomplete or wrong-kind normalized replies in $name", (fixture) => {
    const row = record(readKey(fixture, "row"));
    const value = record(row["value"]);
    const reply = record(value["result"]);
    for (const result of [
      { value: reply["value"] },
      { ...reply, value: { saved: "answer" } },
      { ...reply, call: { ...record(reply["call"]), future: true } },
    ])
      expect(() =>
        decodeStorageRecord({ ...row, value: { ...value, result } }),
      ).toThrow(StorageSchemaError);
  });

  it.each([
    { PK: "SYSTEM#READMODEL" },
    { PK: "LEARNER#" },
    { PK: "LEARNER#bad%escape" },
    { PK: "LEARNER#not%2fcanonical" },
    { SK: "MODEL_TASK#wrong" },
    { SK: undefined },
    { expiresAt: 1 },
  ])("refuses noncanonical task keys and mismatched TTL %j", (change) => {
    expect(() =>
      decodeStorageRecord({ ...taskFixture("in-flight"), ...change }),
    ).toThrow(StorageSchemaError);
  });

  it("refuses TTL metadata on durable families", () => {
    const row = record(readKey(cap3[0], "row"));
    expect(() => decodeStorageRecord({ ...row, expiresAt: 0 })).toThrow(
      StorageSchemaError,
    );
  });
});

describe("storage decoders and subsequent writes", () => {
  it("covers every persistent family, including identity", () => {
    expect(
      fixtures.slice(0, 14).map((fixture) => readKey(fixture.row, "type")),
    ).toStrictEqual(STORAGE_FAMILIES.slice(0, 14));
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
it("admits a strictly bound durable checkpoint only at its cap4 birth", () => {
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
  expect(
    decodeStorageRecord({
      type: "readModelBootstrap",
      version: 1,
      schemaVersion: 4,
      value,
    }).value,
  ).toStrictEqual(value);
  for (const schemaVersion of [0, 1, 2, 3, STORAGE_SCHEMA_VERSION + 1])
    expect(() =>
      decodeStorageRecord({
        type: "readModelBootstrap",
        version: 1,
        schemaVersion,
        value,
      }),
    ).toThrow(StorageSchemaError);
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

const markSchemas = [
  ["absent", {}],
  ["zero", { schemaVersion: 0 }],
  ["one", { schemaVersion: 1 }],
  ["two", { schemaVersion: 2 }],
] as const;
function historicalMark(answeredAt: number) {
  return { sessionId: "historical", result: "ok" as const, elapsedMs: 1, answeredAt };
}
function completeItemRow(value: unknown) {
  return {
    PK: "LEARNER#fixture-owner",
    SK: "ITEM#composition#c1",
    type: "item",
    version: 1,
    value,
  };
}
describe.each(markSchemas)("historical mark times with schema %s", (_, schema) => {
  it("accepts the complete otherwise-valid positive item", () => {
    const value = makeItem();
    expect(
      decodeStorageRecord({ ...completeItemRow(value), ...schema }).value,
    ).toStrictEqual(value);
  });
  describe.each(["last", "previous"] as const)("%s", (field) => {
    it.each([-1, -0.5, 1e20])(
      "retains finite historical timestamp %s without integer or sign conversion",
      (answeredAt) => {
        const value = makeItem({ [field]: historicalMark(answeredAt) });
        expect(
          decodeStorageRecord({ ...completeItemRow(value), ...schema }).value,
        ).toStrictEqual(value);
      },
    );
    it.each([NaN, Infinity, -Infinity])(
      "refuses nonfinite mark time %s",
      (answeredAt) => {
        const value = makeItem({ [field]: historicalMark(answeredAt) });
        expect(() =>
          decodeStorageRecord({ ...completeItemRow(value), ...schema }),
        ).toThrow(expect.objectContaining({ code: "ERR_STORAGE_SHAPE" }));
      },
    );
    it("refuses an unknown mark field instead of silently stripping it", () => {
      const value = {
        ...makeItem(),
        [field]: { ...historicalMark(-1), futureField: "retain" },
      };
      expect(() =>
        decodeStorageRecord({ ...completeItemRow(value), ...schema }),
      ).toThrow(expect.objectContaining({ code: "ERR_STORAGE_SHAPE" }));
    });
  });
});
describe.each(markSchemas.slice(0, 2))(
  "retired marks with legacy schema %s",
  (_, schema) => {
    it.each([0, -1, -0.5, 1e20])(
      "validates signed retired timestamp %s before removing the named field",
      (answeredAt) => {
        const value = makeItem();
        const retired = {
          ...value,
          otherMode: { ...historicalMark(answeredAt), answerMode: "typed" },
        };
        expect(
          decodeStorageRecord({ ...completeItemRow(retired), ...schema }).value,
        ).toStrictEqual(value);
      },
    );
    it.each([
      { ...historicalMark(-1), futureField: "retain" },
      { ...historicalMark(-1), answerMode: "future" },
      historicalMark(NaN),
      historicalMark(Infinity),
      historicalMark(-Infinity),
    ])("refuses a malformed retired mark %j before retirement", (otherMode) => {
      expect(() =>
        decodeStorageRecord({
          ...completeItemRow({ ...makeItem(), otherMode }),
          ...schema,
        }),
      ).toThrow(
        expect.objectContaining({ code: "ERR_STORAGE_SHAPE", path: "retired" }),
      );
    });
  },
);
describe("signed marks retain the surrounding storage fences", () => {
  it.each([1, 2])(
    "rejects retired fields outside legacy schema %s",
    (schemaVersion) => {
      expect(() =>
        decodeStorageRecord({
          ...completeItemRow({
            ...makeItem(),
            otherMode: { ...historicalMark(-1), answerMode: "typed" },
          }),
          schemaVersion,
        }),
      ).toThrow(expect.objectContaining({ code: "ERR_STORAGE_SHAPE" }));
    },
  );
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "does not widen elapsedMs for %s",
    (elapsedMs) => {
      const value = makeItem({ last: { ...historicalMark(-1), elapsedMs } });
      expect(() => decodeStorageRecord(completeItemRow(value))).toThrow(
        expect.objectContaining({ code: "ERR_STORAGE_SHAPE" }),
      );
    },
  );
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "does not widen optimistic version for %s",
    (version) => {
      expect(() =>
        decodeStorageRecord({
          ...completeItemRow(makeItem({ last: historicalMark(-1) })),
          version,
        }),
      ).toThrow(expect.objectContaining({ code: "ERR_STORAGE_SHAPE", path: "row" }));
    },
  );
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "does not widen TTL for %s",
    (expiresAt) => {
      expect(() =>
        decodeStorageRecord({
          ...completeItemRow(makeItem({ last: historicalMark(-1) })),
          expiresAt,
        }),
      ).toThrow(expect.objectContaining({ code: "ERR_STORAGE_SHAPE", path: "row" }));
    },
  );
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "does not widen item revision count for %s",
    (revision) => {
      expect(() =>
        decodeStorageRecord(
          completeItemRow(makeItem({ last: historicalMark(-1), revision })),
        ),
      ).toThrow(expect.objectContaining({ code: "ERR_STORAGE_SHAPE" }));
    },
  );
});
