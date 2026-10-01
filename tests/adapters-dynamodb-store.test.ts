import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDynamoDbDirectory,
  createDynamoDbStores,
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
} from "@instant-composition/adapters";
import {
  DEFAULT_PROFILE,
  learnerId,
  type LearnerDirectory,
  type LearnerStore,
} from "@instant-composition/application";

import { makeReview, makeStats, makeTalk, without } from "./application-fixtures";

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

beforeEach(async () => {
  calls = [];
  answers = [];
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
      const answer = answers.shift() ?? { status: 200, body: {} };
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

describe("a commit", () => {
  it("is one TransactWriteItems in the learner's partition, a resent answer refused by attribute_not_exists", async () => {
    await storeOf().commit({
      puts: [{ type: "review", value: makeReview() }],
      updates: [{ entry: { type: "stats", value: makeStats() }, version: 3 }],
      expect: [{ key: { type: "round", id: "r1" }, version: null }],
    });

    expect(calls.map((call) => call.operation)).toStrictEqual(["TransactWriteItems"]);
    const items = calls[0]?.body["TransactItems"] as Record<
      string,
      Record<string, unknown>
    >[];
    expect(
      items.map(
        (item) =>
          item["Put"]?.["ConditionExpression"] ??
          item["ConditionCheck"]?.["ConditionExpression"],
      ),
    ).toStrictEqual([
      "attribute_not_exists(#pk)",
      "#version = :version",
      "attribute_not_exists(#pk)",
    ]);
    expect(items[0]?.["Put"]?.["Item"]).toMatchObject({
      PK: { S: "LEARNER#learner-a" },
      SK: { S: "ROUND#r1#ANSWER#a1" },
      type: { S: "review" },
      version: { N: "1" },
    });
    expect(items[1]?.["Put"]).toMatchObject({
      Item: { SK: { S: "STATS" }, version: { N: "4" } },
      ExpressionAttributeValues: { ":version": { N: "3" } },
    });
    expect(items[2]?.["ConditionCheck"]?.["Key"]).toStrictEqual({
      PK: { S: "LEARNER#learner-a" },
      SK: { S: "ROUND#r1" },
    });
  });

  it("writes an open talk's expiry beside its value as the TTL attribute, and a kept talk without one", async () => {
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

    const items = calls[0]?.body["TransactItems"] as Record<
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
  it("asks for a consistent read of the one key", async () => {
    answers.push({ status: 200, body: {} });

    expect(await storeOf().round("r#1")).toBeUndefined();
    expect(calls[0]?.body).toMatchObject({
      Key: { PK: { S: "LEARNER#learner-a" }, SK: { S: "ROUND#r%231" } },
      ConsistentRead: true,
    });
  });

  it("follows a query across its pages", async () => {
    const row = (id: string) => ({
      type: { S: "review" },
      version: { N: "1" },
      value: {
        M: {
          id: { S: id },
          sessionId: { S: "r1" },
          answeredAt: { N: id === "a" ? "2" : "1" },
          detail: { M: {} },
        },
      },
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
            value: {
              M: { id: { S: "a1" }, answeredAt: { N: "5" }, detail: { M: {} } },
            },
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

  it("keys items by their id, versions kept", async () => {
    answers.push({
      status: 200,
      body: {
        Items: [
          {
            type: { S: "item" },
            version: { N: "7" },
            value: {
              M: {
                item: { M: { kind: { S: "composition" }, id: { S: "c9" } } },
                last: { NULL: true },
                previous: { NULL: true },
              },
            },
          },
        ],
      },
    });

    const items = await storeOf().items();

    expect([...items].map(([id, stored]) => [id, stored.version])).toStrictEqual([
      ["c9", 7],
    ]);
    expect(calls[0]?.body["ExpressionAttributeValues"]).toMatchObject({
      ":prefix": { S: "ITEM#" },
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

    await expect(storeOf().settings()).rejects.toThrow(TypeError);
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

    expect(calls.map((call) => call.operation)).toStrictEqual(["TransactWriteItems"]);
    const items = calls[0]?.body["TransactItems"] as Record<
      string,
      Record<string, unknown>
    >[];
    expect(items.map((item) => item["Put"]?.["ConditionExpression"])).toStrictEqual([
      "attribute_not_exists(#pk)",
      "attribute_not_exists(#pk)",
    ]);
    expect(items[0]?.["Put"]?.["Item"]).toStrictEqual({
      PK: { S: "IDENTITY#sub%231" },
      SK: { S: "LEARNER" },
      type: { S: "identity" },
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
    answers.push(cancelled(...codes));

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
        body: { Item: { value: { M: { learnerId: { S: "learner-a" } } } } },
      },
      {
        status: 200,
        body: {
          Item: {
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
      body: { Item: { value: { M: { learnerId: { S: "learner-a" } } } } },
    });

    await expect(directoryOf().learnerOf("sub-1")).rejects.toThrow(TypeError);
  });

  it("refuses a row with no value", async () => {
    answers.push({ status: 200, body: { Item: { version: { N: "1" } } } });

    await expect(directoryOf().learnerOf("sub-1")).rejects.toThrow(TypeError);
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
