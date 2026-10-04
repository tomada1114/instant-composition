import { describeRawReadModelContract } from "./raw-read-model-contract";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDynamoDbDirectory,
  createDynamoDbReadModelMaintenance,
  backfillReadModelLearners,
  createDynamoDbStores,
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
  StorageSchemaError,
  STORAGE_SCHEMA_VERSION,
  executeStorageMaintenance,
} from "@instant-composition/adapters";
import {
  DEFAULT_PROFILE,
  learnerId,
  type LearnerDirectory,
  type LearnerStore,
} from "@instant-composition/application";

import {
  makeItem,
  makeReview,
  makeVocabCandidate,
  makeStats,
  makeTalk,
  makePersonalCard,
  makeVocabProgress,
  makeVocabReview,
  without,
} from "./application-fixtures";
import {
  makeCompositionCandidate,
  makeCompositionBuild,
  makeCompositionReadModel,
} from "./composition-fixtures";

// The DynamoDB store's side of the wire, against a fake DynamoDB on a loopback
// port: what each call asks for, and how each answer is read. The contract
// suite runs against DynamoDB local in tests/adapters-dynamodb-local.test.ts;
// this covers what DynamoDB local cannot produce — it never cancels a
// transaction for a conflicting one — and what the contract cannot see.

interface Call {
  readonly operation: string;
  readonly body: Record<string, unknown>;
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

/** The real AWS wire shape, built from complete independently defined fixtures. */
function wire(value: unknown): unknown {
  if (value === null) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(wire) };
  return {
    M: Object.fromEntries(
      Object.entries(value as object).map(([key, part]) => [key, wire(part)]),
    ),
  };
}

const JSON_1_0 = "application/x-amz-json-1.0";

function failure(type: string, extra: Record<string, unknown> = {}): Answer {
  return {
    status: 400,
    body: {
      __type: `com.amazonaws.dynamodb.v20120810#${type}`,
      message: type,
      ...extra,
    },
  };
}

function cancelled(...codes: string[]): Answer {
  return failure("TransactionCanceledException", {
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

let server: Server;
let endpoint = "";
let calls: Call[] = [];
let answers: Answer[] = [];
let pointRows = new Map<string, unknown>();
let returnedRows = 0;

function wireValue(value: unknown): unknown {
  if (value === null) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(wireValue) };
  return {
    M: Object.fromEntries(
      Object.entries(value as object).map(([key, child]) => [key, wireValue(child)]),
    ),
  };
}
function pointRow(key: string, type: string, value: unknown): void {
  pointRows.set(key, {
    PK: { S: "LEARNER#learner-a" },
    SK: { S: key },
    type: { S: type },
    version: { N: "1" },
    schemaVersion: { N: String(STORAGE_SCHEMA_VERSION) },
    value: wireValue(value),
  });
}
let compositionSourceAnswer: Answer | undefined;
let vocabSourceAnswer: Answer | undefined;

beforeEach(async () => {
  calls = [];
  answers = [];
  pointRows = new Map();
  returnedRows = 0;
  compositionSourceAnswer = undefined;
  vocabSourceAnswer = undefined;
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const target = String(request.headers["x-amz-target"] ?? "");
      calls.push({
        operation: target.split(".").at(-1) ?? "",
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
          string,
          unknown
        >,
      });
      const key = calls.at(-1)?.body["Key"] as
        Record<string, { S?: string }> | undefined;
      const found = pointRows.get(key?.["SK"]?.S ?? "");
      if (found !== undefined) returnedRows += 1;
      const sourceRead =
        target.endsWith("GetItem") && key?.["SK"]?.S === "READMODEL#COMPOSITION#SOURCE";
      const vocabSourceRead =
        target.endsWith("GetItem") && key?.["SK"]?.S === "READMODEL#SOURCE";
      const answer = sourceRead
        ? (compositionSourceAnswer ?? { status: 200, body: {} })
        : vocabSourceRead
          ? (vocabSourceAnswer ?? { status: 200, body: {} })
          : (answers.shift() ?? {
              status: 200,
              body: found === undefined ? {} : { Item: found },
            });
      response.writeHead(answer.status, { "content-type": JSON_1_0 });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function storeOf(learner = "learner-a"): LearnerStore {
  return createDynamoDbStores({
    client: localDynamoDbClient(endpoint),
    tableName: "learners",
  }).forLearner(learnerId(learner));
}

function modelTaskResult() {
  return {
    key: {
      talkId: "t#1",
      task: "talk-scene" as const,
      turn: 0,
      promptVersion: "talk-scene@1",
    },
    claimId: "req-1:1",
    input: "private request",
    state: "result" as const,
    attempt: 1,
    duplicatePossible: false,
    startedAt: 1_000,
    expiresAt: 86_401,
    result: {
      value: {
        scene: {
          partner: "barista",
          place: "cafe",
          relation: "customer and barista",
          description: "Order a coffee.",
        },
        opening: "What would you like?",
      },
      call: {
        provider: "scripted",
        modelId: "scripted@1",
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        costUsd: null,
      },
    },
  };
}

function modelTaskRow(
  value: unknown,
  version: number,
  schemaVersion = STORAGE_SCHEMA_VERSION,
) {
  return {
    PK: { S: "LEARNER#learner-a" },
    SK: { S: "MODEL_TASK#t%231#talk-scene#0#talk-scene%401" },
    type: { S: "modelTask" },
    schemaVersion: { N: String(schemaVersion) },
    version: { N: String(version) },
    expiresAt: { N: "86401" },
    value: wire(value),
  };
}
it("rejects a composition source CAS mismatch before any transaction or model writes", async () => {
  compositionSourceAnswer = {
    status: 200,
    body: {
      Item: {
        PK: { S: "LEARNER#learner-a" },
        SK: { S: "READMODEL#COMPOSITION#SOURCE" },
        schemaVersion: { N: String(STORAGE_SCHEMA_VERSION) },
        type: { S: "compositionSource" },
        version: { N: "3" },
        value: { M: { schema: { N: "1" }, epoch: { N: "3" } } },
      },
    },
  };
  expect(
    await storeOf().commit({
      compositionSourceVersion: 2,
      puts: [{ type: "stats", value: makeStats() }],
      updates: [],
      expect: [],
    }),
  ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
  expect(calls.map(({ operation }) => operation)).toStrictEqual(["GetItem"]);
});

it("refuses future composition and compact-stats schemas without coercing them into ready schema1", async () => {
  compositionSourceAnswer = {
    status: 200,
    body: {
      Item: {
        PK: { S: "LEARNER#learner-a" },
        SK: { S: "READMODEL#COMPOSITION#SOURCE" },
        schemaVersion: { N: String(STORAGE_SCHEMA_VERSION) },
        type: { S: "compositionSource" },
        version: { N: "1" },
        value: { M: { schema: { N: "2" }, epoch: { N: "1" } } },
      },
    },
  };
  await expect(storeOf().compositionSource()).rejects.toBeInstanceOf(
    StorageSchemaError,
  );
  answers.push({
    status: 200,
    body: {
      Item: {
        type: { S: "stats" },
        version: { N: "1" },
        value: { M: { streak: { M: { schema: { N: "2" }, longest: { N: "1" } } } } },
      },
    },
  });
  await expect(storeOf().stats()).rejects.toBeInstanceOf(StorageSchemaError);
});

it("writes a ten-candidate composition maintenance page and both cache TTL mirrors within the wire transaction budget", async () => {
  const build = {
    ...makeCompositionBuild(),
    expiresAt: 1800000000,
    concepts: {
      "en:grammar/a": { seen: 10, misses: 5 },
      "en:grammar/b": { seen: 10, misses: 5 },
    },
  };
  const candidates = Array.from({ length: 10 }, (_, at) =>
    makeCompositionCandidate({
      id: `c-${String(at)}`,
      order: String(at).padStart(3, "0"),
      expiresAt: build.expiresAt,
    }),
  );
  expect(
    (
      await storeOf().commit({
        puts: [
          ...candidates.map((value) => ({
            type: "compositionCandidate" as const,
            value,
          })),
          { type: "compositionBuild", value: build },
          {
            type: "compositionReadModel",
            value: { ...makeCompositionReadModel(), expiresAt: build.expiresAt },
          },
        ],
        updates: [],
        expect: [{ key: { type: "compositionSource" }, version: null }],
      })
    ).ok,
  ).toBe(true);
  const call = calls.find(({ operation }) => operation === "TransactWriteItems");
  const items = call?.body["TransactItems"] as {
    Put?: { Item: Record<string, { S?: string; N?: string }> };
  }[];
  expect(items).toHaveLength(13);
  expect(Buffer.byteLength(JSON.stringify(call?.body), "utf8")).toBeLessThan(
    4 * 1024 * 1024,
  );
  for (const write of items.slice(0, 12))
    expect(write.Put?.Item["expiresAt"]?.N).toBe("1800000000");
});

describe("a commit", () => {
  it("is one TransactWriteItems in the learner's partition, a resent answer refused by attribute_not_exists", async () => {
    pointRow("STATS", "stats", makeStats());
    const statsRow = pointRows.get("STATS") as Record<string, unknown>;
    statsRow["version"] = { N: "3" };
    await storeOf().commit({
      puts: [{ type: "review", value: makeReview() }],
      updates: [{ entry: { type: "stats", value: makeStats() }, version: 3 }],
      expect: [{ key: { type: "round", id: "r1" }, version: null }],
    });

    expect(calls.map((call) => call.operation)).toStrictEqual([
      "GetItem",
      "GetItem",
      "GetItem",
      "TransactWriteItems",
    ]);
    expect(calls[1]?.body).toMatchObject({
      ConsistentRead: true,
      Key: { PK: { S: "LEARNER#learner-a" }, SK: { S: "STATS" } },
    });
    const items = calls.at(-1)?.body["TransactItems"] as Record<
      string,
      Record<string, unknown>
    >[];
    expect(items[0]?.["Put"]?.["ConditionExpression"]).toBe(
      "attribute_not_exists(#pk)",
    );
    expect(items[1]?.["Put"]?.["ConditionExpression"]).toBe(
      "attribute_not_exists(#pk)",
    );
    expect(items[2]?.["Put"]?.["ConditionExpression"]).toContain(
      "#value = :observedValue",
    );
    expect(items[2]?.["Put"]?.["ConditionExpression"]).toContain(
      "#schema = :observedSchema",
    );
    expect(items[3]?.["ConditionCheck"]?.["ConditionExpression"]).toBe(
      "attribute_not_exists(#pk)",
    );
    expect(items[0]?.["Put"]?.["Item"]).toMatchObject({
      PK: { S: "LEARNER#learner-a" },
      SK: { S: "ROUND#r1#ANSWER#a1" },
      type: { S: "review" },
      version: { N: "1" },
    });
    expect(items[2]?.["Put"]).toMatchObject({
      Item: { SK: { S: "STATS" }, version: { N: "4" } },
      ExpressionAttributeValues: {
        ":observedVersion": { N: "3" },
        ":observedSchema": { N: "4" },
      },
    });
    expect(items[3]?.["ConditionCheck"]?.["Key"]).toStrictEqual({
      PK: { S: "LEARNER#learner-a" },
      SK: { S: "ROUND#r1" },
    });
  });

  it("deletes a personal card under CARD# at the version read, in the same transaction", async () => {
    pointRow("CARD#p_a%23b", "card", makePersonalCard({ id: "p_a#b" }));
    const cardRow = pointRows.get("CARD#p_a%23b") as Record<string, unknown>;
    cardRow["version"] = { N: "2" };
    pointRow("ITEM#vocab#p_a%23b", "vocabItem", makeVocabProgress({ cardId: "p_a#b" }));
    await storeOf().commit({
      puts: [],
      updates: [],
      expect: [],
      deletes: [
        { key: { type: "card", id: "p_a#b" }, version: 2 },
        { key: { type: "vocabItem", cardId: "p_a#b" }, version: 1 },
      ],
    });

    const items = calls.at(-1)?.body["TransactItems"] as Record<
      string,
      Record<string, unknown>
    >[];
    expect(
      items.flatMap((item) => (item["Delete"] === undefined ? [] : [item["Delete"]])),
    ).toMatchObject([
      {
        Key: { PK: { S: "LEARNER#learner-a" }, SK: { S: "CARD#p_a%23b" } },
        ExpressionAttributeValues: {
          ":observedVersion": { N: "2" },
          ":observedSchema": { N: "4" },
        },
      },
      { Key: { SK: { S: "ITEM#vocab#p_a%23b" } } },
    ]);
  });

  it("writes an open talk's expiry beside its value as the TTL attribute, and a kept talk without one", async () => {
    pointRow("TALK#t2", "talk", makeTalk({ id: "t2" }));
    await storeOf().commit({
      puts: [
        { type: "talk", value: makeTalk({ id: "t#1", expiresAt: 1_790_000_000 }) },
      ],
      updates: [
        {
          entry: { type: "talk", value: without(makeTalk({ id: "t2" }), "expiresAt") },
          version: 1,
        },
      ],
      expect: [],
    });

    const items = calls.at(-1)?.body["TransactItems"] as Record<
      string,
      Record<string, Record<string, unknown>>
    >[];
    expect(items[0]?.["Put"]?.["Item"]).toMatchObject({
      SK: { S: "TALK#t%231" },
      type: { S: "talk" },
      expiresAt: { N: "1790000000" },
    });
    expect(items[1]?.["Put"]?.["Item"]?.["SK"]).toStrictEqual({ S: "TALK#t2" });
    expect(items[1]?.["Put"]?.["Item"]).not.toHaveProperty("expiresAt");
  });

  it("claims and finishes a model task under its escaped semantic key with an independent TTL", async () => {
    const saved = modelTaskResult();
    const { result, ...identity } = saved;
    const { key } = identity;
    const claim = { ...identity, state: "in-flight" as const, leaseUntil: 31_000 };
    await storeOf().commit({
      puts: [{ type: "modelTask", value: claim }],
      updates: [],
      expect: [],
    });
    const items = calls[0]?.body["TransactItems"] as Record<
      string,
      Record<string, unknown>
    >[];
    expect(items[0]?.["Put"]?.["Item"]).toStrictEqual(modelTaskRow(claim, 1));
    expect(items[0]?.["Put"]?.["ConditionExpression"]).toBe(
      "attribute_not_exists(#pk)",
    );
    answers.push({ status: 200, body: { Item: modelTaskRow(saved, 2) } });
    expect(await storeOf().modelTask(key)).toStrictEqual({ value: saved, version: 2 });
    expect(calls[1]?.body).toMatchObject({
      Key: {
        PK: { S: "LEARNER#learner-a" },
        SK: { S: "MODEL_TASK#t%231#talk-scene#0#talk-scene%401" },
      },
      ConsistentRead: true,
    });

    answers.push({ status: 200, body: { Item: modelTaskRow(claim, 1, 3) } });
    await storeOf().commit({
      puts: [],
      updates: [
        {
          entry: {
            type: "modelTask",
            value: { ...identity, result },
          },
          version: 1,
          modelClaim: claim.claimId,
        },
      ],
      expect: [],
    });
    const finished = calls.at(-1)?.body["TransactItems"] as Record<
      string,
      Record<string, unknown>
    >[];
    expect(finished[0]?.["Put"]?.["Item"]).toStrictEqual(modelTaskRow(saved, 2));
    expect(calls.map((call) => call.operation)).toStrictEqual([
      "TransactWriteItems",
      "GetItem",
      "GetItem",
      "TransactWriteItems",
    ]);
    expect(finished[0]?.["Put"]?.["ConditionExpression"]).toContain(
      "#value.#claim = :claim",
    );
    expect(finished[0]?.["Put"]?.["ConditionExpression"]).toContain(
      "#value = :observedValue",
    );
    expect(finished[0]?.["Put"]).toMatchObject({
      ExpressionAttributeValues: {
        ":observedVersion": { N: "1" },
        ":observedSchema": { N: "3" },
        ":storage3": { N: "3" },
        ":schema": { N: "4" },
        ":claim": { S: "req-1:1" },
      },
    });
  });

  it("sends nothing when it names nothing", async () => {
    expect((await storeOf().commit({ puts: [], updates: [], expect: [] })).ok).toBe(
      true,
    );
    expect(calls).toStrictEqual([]);
  });

  it.each([
    ["a failed condition", ["None", "ConditionalCheckFailed"]],
    ["a conflicting transaction", ["TransactionConflict", "None"]],
  ])("answers ERR_CONFLICT when cancelled for %s", async (_, codes) => {
    answers.push(cancelled(...codes));

    expect(
      await storeOf().commit({
        puts: [{ type: "stats", value: makeStats() }],
        updates: [],
        expect: [{ key: { type: "settings" }, version: null }],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
  });

  it.each([
    [
      "a cancellation no retry can clear",
      cancelled("ConditionalCheckFailed", "ValidationError"),
      "TransactionCanceledException",
    ],
    [
      "a cancellation that names no reason",
      cancelled("None"),
      "TransactionCanceledException",
    ],
    [
      "any other failure",
      failure("ResourceNotFoundException"),
      "ResourceNotFoundException",
    ],
  ])("throws on %s", async (_, answer, name) => {
    answers.push(answer);

    await expect(
      storeOf().commit({
        puts: [{ type: "stats", value: makeStats() }],
        updates: [],
        expect: [],
      }),
    ).rejects.toMatchObject({ name });
  });
});

describe("a read", () => {
  it("refuses an unexpected model task field without issuing a follow-up write", async () => {
    const saved = modelTaskResult();
    answers.push({
      status: 200,
      body: { Item: modelTaskRow({ ...saved, retired: "unknown field" }, 2) },
    });
    const reading = storeOf().modelTask(saved.key);
    await expect(reading).rejects.toBeInstanceOf(StorageSchemaError);
    await expect(reading).rejects.toMatchObject({ code: "ERR_STORAGE_SHAPE" });
    expect(calls.map((call) => call.operation)).toStrictEqual(["GetItem"]);
  });

  it("asks for a consistent read of the one key", async () => {
    answers.push({ status: 200, body: {} });

    expect(await storeOf().round("r#1")).toBeUndefined();
    expect(calls[0]?.body).toMatchObject({
      Key: { PK: { S: "LEARNER#learner-a" }, SK: { S: "ROUND#r%231" } },
      ConsistentRead: true,
    });
  });

  it("reads one strong primary calendar page and binds its cursor to the learner and range", async () => {
    answers.push({
      status: 200,
      body: {
        Items: [],
        LastEvaluatedKey: {
          PK: { S: "LEARNER#learner-a" },
          SK: { S: "PORTION#2026-09-10" },
        },
      },
    });
    const range = { from: "2026-09-01", to: "2026-09-30", limit: 10 };
    const first = await storeOf().portionsPage(range);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      operation: "Query",
      body: {
        ConsistentRead: true,
        Limit: 10,
        KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :first AND :last",
        ExpressionAttributeValues: {
          ":pk": { S: "LEARNER#learner-a" },
          ":first": { S: "PORTION#2026-09-01" },
          ":last": { S: "PORTION#2026-09-30" },
        },
      },
    });
    expect(calls[0]?.body).not.toHaveProperty("IndexName");
    if (first.cursor === null) throw new Error("The page cursor fixture is missing.");
    await storeOf().portionsPage({ ...range, cursor: first.cursor });
    expect(calls[1]?.body["ExclusiveStartKey"]).toStrictEqual({
      PK: { S: "LEARNER#learner-a" },
      SK: { S: "PORTION#2026-09-10" },
    });
    await expect(
      storeOf("learner-b").portionsPage({ ...range, cursor: first.cursor }),
    ).rejects.toThrow(RangeError);
    await expect(
      storeOf().portionsPage({ ...range, to: "2026-10-01", cursor: first.cursor }),
    ).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(2);
  });

  it("looks up streak predecessor and successor with two strong queries limited to one each", async () => {
    expect(await storeOf().streakNeighbours("2026-09-22")).toStrictEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls.map(({ operation }) => operation)).toStrictEqual(["Query", "Query"]);
    expect(calls.map(({ body }) => body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ConsistentRead: true,
          Limit: 1,
          ScanIndexForward: false,
        }),
        expect.objectContaining({
          ConsistentRead: true,
          Limit: 1,
          ScanIndexForward: true,
        }),
      ]),
    );
  });

  it("follows a query across its pages", async () => {
    const row = (id: string) => ({
      type: { S: "review" },
      version: { N: "1" },
      value: wire(makeReview({ id, answeredAt: id === "a" ? 2 : 1 })),
    });
    answers.push(
      {
        status: 200,
        body: {
          Items: [row("a")],
          LastEvaluatedKey: { PK: { S: "p" }, SK: { S: "s" } },
        },
      },
      { status: 200, body: { Items: [row("b")] } },
    );

    const reviews = await storeOf().reviewsOf("r1");

    expect(reviews.map((review) => review.id)).toStrictEqual(["b", "a"]);
    expect(calls.map((call) => call.body["ExclusiveStartKey"])).toStrictEqual([
      undefined,
      { PK: { S: "p" }, SK: { S: "s" } },
    ]);
    expect(calls[0]?.body["ExpressionAttributeValues"]).toMatchObject({
      ":pk": { S: "LEARNER#learner-a" },
      ":prefix": { S: "ROUND#r1#ANSWER#" },
    });
  });

  it("reads the whole log under the round prefix, leaving the rounds beside it out", async () => {
    answers.push({
      status: 200,
      body: {
        Items: [
          {
            type: { S: "round" },
            version: { N: "2" },
            value: { M: { id: { S: "r1" } } },
          },
          {
            type: { S: "review" },
            version: { N: "1" },
            value: wire(makeReview({ id: "a1", answeredAt: 5 })),
          },
        ],
      },
    });

    const reviews = await storeOf().reviews();

    expect(reviews.map((review) => review.id)).toStrictEqual(["a1"]);
    expect(calls[0]?.body["ExpressionAttributeValues"]).toMatchObject({
      ":prefix": { S: "ROUND#" },
    });
  });

  it("keys the drill's items by their id, versions kept, reading their kind alone", async () => {
    answers.push({
      status: 200,
      body: {
        Items: [
          {
            type: { S: "item" },
            version: { N: "7" },
            value: wire(makeItem({ item: { kind: "composition", id: "c9" } })),
          },
        ],
      },
    });

    const items = await storeOf().items();

    expect([...items].map(([id, stored]) => [id, stored.version])).toStrictEqual([
      ["c9", 7],
    ]);
    expect(calls[0]?.body["ExpressionAttributeValues"]).toMatchObject({
      ":prefix": { S: "ITEM#composition#" },
    });
  });

  it("reads a window of days as one range", async () => {
    answers.push({ status: 200, body: { Items: [] } });

    await storeOf().days(["2026-09-22", "2026-09-20", "2026-09-21"]);

    expect(calls[0]?.body["ExpressionAttributeValues"]).toMatchObject({
      ":first": { S: "DAY#2026-09-20" },
      ":last": { S: "DAY#2026-09-22" },
    });
  });

  it("asks for nothing when it is given no days", async () => {
    expect((await storeOf().days([])).size).toBe(0);
    expect(calls).toStrictEqual([]);
  });

  it("refuses a row with no version rather than guessing one", async () => {
    answers.push({ status: 200, body: { Item: { value: { M: {} } } } });

    await expect(storeOf().settings()).rejects.toThrow(StorageSchemaError);
  });
});

function directoryOf(): LearnerDirectory {
  return createDynamoDbDirectory({
    client: localDynamoDbClient(endpoint),
    tableName: "learners",
  });
}

const REGISTRATION = { learnerId: learnerId("learner-a"), profile: DEFAULT_PROFILE };

describe("the learner directory", () => {
  it("registers as one TransactWriteItems: the mapping and the profile, each only while absent", async () => {
    expect(await directoryOf().register("sub#1", REGISTRATION)).toStrictEqual({
      ok: true,
      value: undefined,
    });

    expect(calls.map((call) => call.operation)).toStrictEqual([
      "GetItem",
      "GetItem",
      "GetItem",
      "TransactWriteItems",
    ]);
    expect(
      calls.slice(0, 3).every((call) => call.body["ConsistentRead"] === true),
    ).toBe(true);
    const items = calls.at(-1)?.body["TransactItems"] as Record<
      string,
      Record<string, unknown>
    >[];
    expect(items.map((item) => item["Put"]?.["ConditionExpression"])).toStrictEqual([
      "attribute_not_exists(#pk)",
      "attribute_not_exists(#pk)",
      "attribute_not_exists(#pk)",
    ]);
    expect(items[0]?.["Put"]?.["Item"]).toStrictEqual({
      PK: { S: "IDENTITY#sub%231" },
      SK: { S: "LEARNER" },
      type: { S: "identity" },
      schemaVersion: { N: String(STORAGE_SCHEMA_VERSION) },
      version: { N: "1" },
      value: { M: { learnerId: { S: "learner-a" } } },
    });
    expect(items[1]?.["Put"]?.["Item"]).toMatchObject({
      PK: { S: "LEARNER#learner-a" },
      SK: { S: "PROFILE" },
      type: { S: "profile" },
      version: { N: "1" },
      value: {
        M: {
          timeZone: { S: "Asia/Tokyo" },
          l1: { S: "ja" },
          target: { S: "en" },
          uiLocale: { S: "ja" },
        },
      },
    });
  });

  it.each([
    ["a subject already mapped", ["ConditionalCheckFailed", "None"]],
    ["a concurrent registration", ["TransactionConflict", "None"]],
  ])("answers ERR_CONFLICT when cancelled for %s", async (_, codes) => {
    answers.push(
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 200, body: {} },
      cancelled(...codes),
    );

    expect(await directoryOf().register("sub-1", REGISTRATION)).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
  });

  it("throws on a failure no retry can clear", async () => {
    answers.push(failure("ResourceNotFoundException"));

    await expect(directoryOf().register("sub-1", REGISTRATION)).rejects.toMatchObject({
      name: "ResourceNotFoundException",
    });
  });

  it("reads the mapping, then the profile in the learner's partition, both consistently", async () => {
    answers.push(
      {
        status: 200,
        body: {
          Item: {
            type: { S: "identity" },
            version: { N: "1" },
            value: { M: { learnerId: { S: "learner-a" } } },
          },
        },
      },
      {
        status: 200,
        body: {
          Item: {
            type: { S: "profile" },
            version: { N: "1" },
            value: {
              M: {
                timeZone: { S: "Asia/Tokyo" },
                l1: { S: "ja" },
                target: { S: "en" },
                uiLocale: { S: "ja" },
              },
            },
          },
        },
      },
    );

    expect(await directoryOf().learnerOf("sub-1")).toStrictEqual({
      learnerId: "learner-a",
      profile: { timeZone: "Asia/Tokyo", l1: "ja", target: "en", uiLocale: "ja" },
    });
    expect(calls.map((call) => call.body)).toMatchObject([
      {
        Key: { PK: { S: "IDENTITY#sub-1" }, SK: { S: "LEARNER" } },
        ConsistentRead: true,
      },
      {
        Key: { PK: { S: "LEARNER#learner-a" }, SK: { S: "PROFILE" } },
        ConsistentRead: true,
      },
    ]);
  });

  it("answers an unmapped subject with nothing, reading no profile", async () => {
    expect(await directoryOf().learnerOf("sub-1")).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("refuses a mapping whose learner has no profile rather than inventing one", async () => {
    answers.push({
      status: 200,
      body: {
        Item: {
          type: { S: "identity" },
          version: { N: "1" },
          value: { M: { learnerId: { S: "learner-a" } } },
        },
      },
    });

    await expect(directoryOf().learnerOf("sub-1")).rejects.toThrow(TypeError);
  });

  it("refuses a row with no value", async () => {
    answers.push({ status: 200, body: { Item: { version: { N: "1" } } } });

    await expect(directoryOf().learnerOf("sub-1")).rejects.toThrow(StorageSchemaError);
  });
});

describe("DynamoDB local", () => {
  it.each([
    "https://dynamodb.us-east-1.amazonaws.com",
    "http://10.0.0.8:8000",
    "localhost:8000",
    "",
  ])("refuses %p as an endpoint", (target) => {
    expect(() => localDynamoDbClient(target)).toThrow(RangeError);
  });

  it("creates and deletes a learner table keyed PK and SK", async () => {
    const client = localDynamoDbClient(endpoint);

    await createLearnerTable(client, "learners-x");
    await deleteLearnerTable(client, "learners-x");

    expect(calls.map((call) => call.operation)).toStrictEqual([
      "CreateTable",
      "DeleteTable",
    ]);
    expect(calls[0]?.body).toMatchObject({
      TableName: "learners-x",
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    });
  });
});

describe("the explicit storage maintenance adapter", () => {
  const settings = { topics: ["daily"], focus: [], dailySize: 5, sound: true };
  const key = { PK: "LEARNER#learner-a", SK: "SETTINGS" };
  const options = () => ({ table: "learners", region: "ap-northeast-1", endpoint });
  const wireRow = (row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).map(([name, value]) => [name, wire(value)]));
  it("pages a bounded consistent raw inventory without rewriting reads", async () => {
    const row = { ...key, type: "settings", version: 1, value: settings };
    answers.push({
      status: 200,
      body: { Items: [wireRow(row)], LastEvaluatedKey: wireRow(key) },
    });
    expect(
      await executeStorageMaintenance({ ...options(), command: "page", cursor: null }),
    ).toStrictEqual({ rows: [row], cursor: key });
    expect(calls[0]?.body).toMatchObject({ Limit: 100, ConsistentRead: true });
    answers.push({ status: 200, body: {} });
    expect(
      await executeStorageMaintenance({ ...options(), command: "page", cursor: key }),
    ).toStrictEqual({ rows: [], cursor: null });
    expect(calls[1]?.body).toHaveProperty("ExclusiveStartKey", wireRow(key));
  });
  it("gets one row consistently and distinguishes an absent key", async () => {
    const row = { ...key, type: "settings", version: 1, value: settings };
    answers.push({ status: 200, body: { Item: wireRow(row) } });
    expect(
      await executeStorageMaintenance({ ...options(), command: "get", key }),
    ).toStrictEqual(row);
    expect(calls[0]?.body).toHaveProperty("ConsistentRead", true);
    expect(
      await executeStorageMaintenance({ ...options(), command: "get", key }),
    ).toBeNull();
  });
  it.each([0, 1])(
    "replaces only the expected row/schema revision %s",
    async (schema) => {
      const row = {
        ...key,
        type: "settings",
        version: 2,
        schemaVersion: STORAGE_SCHEMA_VERSION,
        value: settings,
      };
      const source = {
        ...key,
        type: "settings",
        version: 1,
        schemaVersion: schema,
        value: settings,
      };
      answers.push({ status: 200, body: { Item: wireRow(source) } });
      expect(
        await executeStorageMaintenance({
          ...options(),
          command: "replace",
          key,
          row,
          version: 1,
          schema,
        }),
      ).toBe(true);
      expect(calls.at(-1)?.body).toMatchObject({
        ExpressionAttributeValues: {
          ":observedVersion": { N: "1" },
          ":observedSchema": { N: String(schema) },
          ":schema": { N: "4" },
        },
      });
      expect(calls.at(-1)?.body["ConditionExpression"]).toContain(
        "#value = :observedValue",
      );
      expect(calls.at(-1)?.body["ConditionExpression"]).toContain(
        "attribute_not_exists(#expiry)",
      );
      answers.push(
        { status: 200, body: { Item: wireRow(source) } },
        failure("ConditionalCheckFailedException"),
      );
      expect(
        await executeStorageMaintenance({
          ...options(),
          command: "replace",
          key,
          row,
          version: 1,
          schema,
        }),
      ).toBe(false);
    },
  );
  it("refuses an unknown legacy source shape before replacing it", async () => {
    const source = {
      ...key,
      type: "settings",
      version: 1,
      value: { ...settings, futurePersistedField: "retain" },
    };
    answers.push({ status: 200, body: { Item: wireRow(source) } });
    await expect(
      executeStorageMaintenance({
        ...options(),
        command: "replace",
        key,
        row: {
          ...key,
          type: "settings",
          version: 2,
          schemaVersion: STORAGE_SCHEMA_VERSION,
          value: settings,
        },
        version: 1,
        schema: 0,
      }),
    ).rejects.toBeInstanceOf(StorageSchemaError);
    expect(calls.map((call) => call.operation)).toStrictEqual(["GetItem"]);
  });
  it("refuses invalid replacements before sending a destructive write", async () => {
    const row = {
      ...key,
      type: "settings",
      version: 2,
      schemaVersion: STORAGE_SCHEMA_VERSION + 1,
      value: settings,
    };
    await expect(
      executeStorageMaintenance({
        ...options(),
        command: "replace",
        key,
        row,
        version: 1,
        schema: 0,
      }),
    ).rejects.toBeInstanceOf(StorageSchemaError);
    await expect(
      executeStorageMaintenance({
        ...options(),
        command: "replace",
        key,
        row: { ...row, schemaVersion: STORAGE_SCHEMA_VERSION, version: 3 },
        version: 1,
        schema: 0,
      }),
    ).rejects.toThrow("Invalid migration replacement");
    await expect(
      executeStorageMaintenance({
        ...options(),
        command: "replace",
        key,
        row: { ...row, schemaVersion: STORAGE_SCHEMA_VERSION, SK: "OTHER" },
        version: 1,
        schema: 0,
      }),
    ).rejects.toBeInstanceOf(StorageSchemaError);
    await expect(
      executeStorageMaintenance({
        ...options(),
        command: "replace",
        key,
        row: { ...row, schemaVersion: STORAGE_SCHEMA_VERSION },
        version: 1,
        schema: STORAGE_SCHEMA_VERSION + 1,
      }),
    ).rejects.toBeInstanceOf(StorageSchemaError);
    expect(calls).toHaveLength(0);
  });
  it("propagates provider failures without pretending a write succeeded", async () => {
    answers.push(failure("AccessDeniedException"));
    await expect(
      executeStorageMaintenance({
        ...options(),
        command: "replace",
        key,
        row: {
          ...key,
          type: "settings",
          version: 2,
          schemaVersion: STORAGE_SCHEMA_VERSION,
          value: settings,
        },
        version: 1,
        schema: 0,
      }),
    ).rejects.toThrow("AccessDeniedException");
  });
});

describe("keyed answer reads", () => {
  it.each([0, 1_000])(
    "issues the same point requests with %i unrelated rows outside their keys",
    async (noise) => {
      const unrelated = Array.from(
        { length: noise },
        (_, index) => `ITEM#composition#other-${String(index)}`,
      );
      for (const key of unrelated)
        pointRow(key, "item", makeItem({ item: { kind: "composition", id: key } }));
      pointRow(
        "ITEM#composition#target",
        "item",
        makeItem({ item: { kind: "composition", id: "target" } }),
      );
      pointRow(
        "ROUND#r%231#ANSWER#answer",
        "review",
        makeReview({ id: "answer", sessionId: "r#1" }),
      );
      pointRow(
        "ITEM#vocab#target",
        "vocabItem",
        makeVocabProgress({ cardId: "target" }),
      );
      pointRow(
        "VOCAB#s%231#ANSWER#answer",
        "vocabReview",
        makeVocabReview({ id: "answer", sessionId: "s#1", cardId: "target" }),
      );
      pointRow("CARD#target", "card", makePersonalCard({ id: "target" }));
      const store = storeOf();
      expect((await store.itemsByIds(["target", "target", "absent"])).size).toBe(1);
      expect(
        (await store.reviewsByIds("r#1", ["answer", "answer", "absent"])).size,
      ).toBe(1);
      expect((await store.vocabItemsByIds(["target", "target", "absent"])).size).toBe(
        1,
      );
      expect(
        (await store.vocabReviewsByIds("s#1", ["answer", "answer", "absent"])).size,
      ).toBe(1);
      expect((await store.cardsByIds(["target", "target", "absent"])).size).toBe(1);
      expect(calls.map((call) => call.operation)).toStrictEqual(
        Array<string>(10).fill("GetItem"),
      );
      const keys = calls.map(
        (call) => (call.body["Key"] as Record<string, { S: string }>)["SK"]?.S,
      );
      expect(keys).toStrictEqual([
        "ITEM#composition#target",
        "ITEM#composition#absent",
        "ROUND#r%231#ANSWER#answer",
        "ROUND#r%231#ANSWER#absent",
        "ITEM#vocab#target",
        "ITEM#vocab#absent",
        "VOCAB#s%231#ANSWER#answer",
        "VOCAB#s%231#ANSWER#absent",
        "CARD#target",
        "CARD#absent",
      ]);
      expect(keys.some((key) => unrelated.includes(key ?? ""))).toBe(false);
      expect(returnedRows).toBe(5);
      expect(calls.filter((call) => call.operation === "Query")).toHaveLength(0);
      expect(calls.every((call) => call.body["ConsistentRead"] === true)).toBe(true);
    },
  );
  it("reads one bounded legacy page and returns its opaque checkpoint without following it", async () => {
    answers.push({
      status: 200,
      body: {
        Items: [],
        LastEvaluatedKey: {
          PK: { S: "LEARNER#learner-a" },
          SK: { S: "ROUND#r1#ANSWER#next" },
        },
      },
    });
    expect(await storeOf().reviewPage("r1", null)).toStrictEqual({
      entries: [],
      cursor: "ROUND#r1#ANSWER#next",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      Limit: 32,
      ConsistentRead: true,
      ExpressionAttributeValues: { ":prefix": { S: "ROUND#r1#ANSWER#" } },
    });
    await storeOf().reviewPage("r1", "ROUND#r1#ANSWER#next");
    expect(calls[1]?.body["ExclusiveStartKey"]).toStrictEqual({
      PK: { S: "LEARNER#learner-a" },
      SK: { S: "ROUND#r1#ANSWER#next" },
    });
    await expect(storeOf().reviewPage("r1", "ROUND#other#ANSWER#next")).rejects.toThrow(
      RangeError,
    );
    expect(calls).toHaveLength(2);
  });
});

describe("read-model registry and cache transport", () => {
  it("queries only the strongly consistent primary registry with a fixed page, regardless of unrelated history", async () => {
    const options = { client: localDynamoDbClient(endpoint), tableName: "learners" };
    const maintenance = createDynamoDbReadModelMaintenance(options);
    for (const history of [0, 1_000_000]) {
      answers.push({ status: 200, body: { Items: [], ScannedCount: history } });
      expect(await maintenance.profiles(null)).toStrictEqual({
        learners: [],
        cursor: null,
      });
    }
    expect(calls.map(({ operation }) => operation)).toStrictEqual(["Query", "Query"]);
    for (const call of calls)
      expect(call.body).toMatchObject({
        ConsistentRead: true,
        Limit: 100,
        KeyConditionExpression: "#pk = :registry",
        ExpressionAttributeValues: { ":registry": { S: "SYSTEM#READMODEL_LEARNERS" } },
      });
  });
  it("keeps legacy Scan discovery an explicit bounded backfill operation", async () => {
    const options = { client: localDynamoDbClient(endpoint), tableName: "learners" };
    answers.push({ status: 200, body: { Items: [], ScannedCount: 100 } });
    expect(await backfillReadModelLearners(options, null)).toStrictEqual({
      cursor: null,
      rows: 100,
    });
    expect(calls).toMatchObject([
      { operation: "Scan", body: { ConsistentRead: true, Limit: 100 } },
    ]);
  });
  it("copies cache expiry beside the value for TTL and guards raw source schema", async () => {
    await storeOf().commit({
      puts: [
        { type: "vocabReadModelRequest", value: { schema: 1, day: "2026-09-19" } },
      ],
      updates: [],
      expect: [],
    });
    expect(
      (calls[0]?.body["TransactItems"] as Record<string, unknown>[])[0],
    ).toMatchObject({ Put: { Item: { type: { S: "vocabReadModelRequest" } } } });
    expect(
      (
        calls[0]?.body["TransactItems"] as Record<string, Record<string, unknown>>[]
      )[0]?.["Put"]?.["Item"],
    ).not.toHaveProperty("expiresAt");
  });
});

describe("versioned cache decoding", () => {
  it("mirrors generated candidate TTL beside its declared value", async () => {
    await storeOf().commit({
      puts: [
        {
          type: "vocabCandidate",
          value: makeVocabCandidate({ expiresAt: 1_800_000_000 }),
        },
      ],
      updates: [],
      expect: [],
    });
    expect(
      (calls[0]?.body["TransactItems"] as Record<string, unknown>[])[0],
    ).toMatchObject({
      Put: {
        Item: {
          expiresAt: { N: "1800000000" },
          value: { M: { expiresAt: { N: "1800000000" } } },
        },
      },
    });
  });
  it("rejects unknown source schema rather than returning a usable empty epoch", async () => {
    vocabSourceAnswer = {
      status: 200,
      body: {
        Item: {
          type: { S: "readModelSource" },
          value: { M: { schema: { N: "2" } } },
          version: { N: "1" },
        },
      },
    };
    await expect(storeOf().readModelSource()).rejects.toBeInstanceOf(Error);
  });
});

describeRawReadModelContract("DynamoDB wire", (rows) => {
  for (const row of rows)
    pointRows.set(String(row["SK"]), (wire(row) as { M: unknown }).M);
  const options = { client: localDynamoDbClient(endpoint), tableName: "learners" };
  return {
    stores: createDynamoDbStores(options),
    maintenance: createDynamoDbReadModelMaintenance(options),
  };
});
