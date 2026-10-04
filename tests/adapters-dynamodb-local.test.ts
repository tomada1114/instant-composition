import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createDynamoDbStores,
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
  StorageSchemaError,
} from "@instant-composition/adapters";

import {
  finishRound,
  recordAnswers,
  startRound,
  updateSettings,
  startTalk,
  type ApplicationDeps,
  type LearnerStore,
} from "@instant-composition/application";

import { answersFor, fixedCatalog, makeHarness, NOON } from "./application-harness";
import { localTables } from "./dynamodb-local";
import { describeLearnerDirectoryContract } from "./learner-directory-contract";
import { describeLearnerStoreContract } from "./learner-store-contract";
import { describeBoundedAnswerContract } from "./bounded-answer-contract";
import { describeModelTaskContract } from "./model-task-contract";
import { describeFirstAnswerContract } from "./first-answer-contract";
import { describeVocabCardDeletionContract } from "./vocab-card-deletion-contract";
import { makeTalkHarness } from "./application-talk-harness";
import { makeReview } from "./application-fixtures";
import { TALK_TUNING } from "@instant-composition/domain";
import { parseJson, readKey } from "../scripts/lib/json.mjs";

/** Complete wire values for controlled corruptions the application cannot emit. */
function wire(value: unknown): unknown {
  if (value === null) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(wire) };
  if (typeof value !== "object") throw new TypeError("Unsupported wire value.");
  return { M: wireRow(value) };
}

function wireRow(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, wire(field)]),
  );
}

/** Always the local emulator, with synthetic signing metadata and no credentials. */
async function rawLocal(
  operation: "PutItem" | "GetItem",
  input: unknown,
): Promise<unknown> {
  const response = await fetch("http://127.0.0.1:8000", {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.0",
      "x-amz-target": `DynamoDB_20120810.${operation}`,
      "x-amz-date": "20260101T000000Z",
      authorization: `AWS4-HMAC-SHA256 Credential=local/20260101/local/dynamodb/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=${"0".repeat(64)}`,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Local DynamoDB wire request failed.");
  return parseJson(await response.text());
}

// The DynamoDB store and directory against DynamoDB local: both contract
// suites, each case on a table of its own, then a command flow through the
// application.
// Needs `pnpm db:up`; `pnpm test:dynamodb` runs it, never the default suite.

const tables = localTables();

beforeAll(async () => {
  await tables.reachable();
});

afterAll(async () => {
  await tables.close();
});

describeLearnerStoreContract("the DynamoDB store", () => tables.fresh());
describeBoundedAnswerContract("adapters-dynamodb-local.test.ts", () => tables.fresh());
describeModelTaskContract("persisted model tasks with DynamoDB", () => tables.fresh());
describeFirstAnswerContract("first answers with DynamoDB", () => tables.fresh());
describeVocabCardDeletionContract("personal card deletion with DynamoDB", () =>
  tables.fresh(),
);
describeLearnerDirectoryContract("the DynamoDB directory", () => tables.freshBacking());

describe("model claim schema races with DynamoDB", () => {
  it.each([undefined, 0, 1, 2])(
    "refuses a task changed to schema %s after preflight without partially writing or invoking the provider",
    async (schemaVersion) => {
      const client = localDynamoDbClient("http://localhost:8000");
      const tableName = `model-claim-${randomUUID()}`;
      await createLearnerTable(client, tableName);
      try {
        const stores = createDynamoDbStores({ client, tableName });
        const h = makeTalkHarness();
        const store = stores.forLearner(h.learner);
        const crash = new Error("Result storage interrupted.");
        const interrupted: LearnerStore = {
          ...store,
          commit(commit) {
            if (commit.updates.some(({ entry }) => entry.type === "modelTask"))
              throw crash;
            return store.commit(commit);
          },
        };
        await expect(
          startTalk(
            { ...h.talkDeps, stores: { forLearner: () => interrupted } },
            h.context(),
            { talkId: "t1" },
          ),
        ).rejects.toBe(crash);
        const taskKey = {
          talkId: "t1",
          task: "talk-scene" as const,
          turn: 0,
          promptVersion: "talk-scene@1",
        };
        const original = await store.modelTask(taskKey);
        if (original === undefined) throw new Error("Missing abandoned claim.");
        const key = {
          PK: `LEARNER#${encodeURIComponent(h.learner)}`,
          SK: "MODEL_TASK#t1#talk-scene#0#talk-scene%401",
        };
        const replacement = {
          ...key,
          type: "modelTask",
          version: original.version,
          value: original.value,
          expiresAt: original.value.expiresAt,
          ...(schemaVersion === undefined ? {} : { schemaVersion }),
        };
        let injected = false;
        client.middlewareStack.add(
          (next) => async (args) => {
            if (!injected && "TransactItems" in args.input) {
              injected = true;
              await rawLocal("PutItem", {
                TableName: tableName,
                Item: wireRow(replacement),
              });
            }
            return next(args);
          },
          { step: "initialize", name: "changeModelClaimSchemaAfterPreflight" },
        );
        const atomic: LearnerStore = {
          ...store,
          commit(commit) {
            return store.commit({
              ...commit,
              puts: [...commit.puts, { type: "review", value: makeReview() }],
            });
          },
        };
        await expect(
          startTalk(
            { ...h.talkDeps, stores: { forLearner: () => atomic } },
            h.context(NOON + TALK_TUNING.modelLeaseMs),
            { talkId: "t1" },
          ),
        ).rejects.toBeInstanceOf(StorageSchemaError);
        expect(injected).toBe(true);
        expect(
          readKey(
            await rawLocal("GetItem", {
              TableName: tableName,
              Key: wireRow(key),
              ConsistentRead: true,
            }),
            "Item",
          ),
        ).toStrictEqual(wireRow(replacement));
        expect(await store.reviewsOf("r1")).toStrictEqual([]);
        expect(await store.talk("t1")).toBeUndefined();
        expect(h.model.requests).toHaveLength(1);
      } finally {
        await deleteLearnerTable(client, tableName);
        client.destroy();
      }
    },
  );
});

/** Every read of the learner's store, versions included. */
async function everything(store: LearnerStore): Promise<unknown> {
  return {
    settings: await store.settings(),
    stats: await store.stats(),
    reviews: await store.reviews(),
    items: [...(await store.items())],
  };
}

describe("the DynamoDB store under the application", () => {
  it("records a batch once however often it is sent, then finishes the round", async () => {
    const h = makeHarness();
    const deps: ApplicationDeps = {
      stores: await tables.fresh(),
      catalog: fixedCatalog(),
    };
    const store = deps.stores.forLearner(h.learner);
    const saved = await updateSettings(deps, h.context(), {
      topics: ["work", "travel"],
      dailySize: 10,
    });
    expect(saved.ok).toBe(true);
    const started = await startRound(deps, h.context(), {
      kind: "placement",
      roundId: "p1",
    });
    if (!started.ok) {
      throw new Error(`Starting the placement failed with ${started.error.code}.`);
    }
    const batch = { roundId: "p1", answers: answersFor(started.value) };

    expect((await recordAnswers(deps, h.context(), batch)).ok).toBe(true);
    const once = await everything(store);
    expect((await recordAnswers(deps, h.context(NOON + 1_000), batch)).ok).toBe(true);
    expect(await everything(store)).toStrictEqual(once);
    expect(await store.reviewsOf("p1")).toHaveLength(10);

    const finished = await finishRound(deps, h.context(), batch);
    expect(finished.ok).toBe(true);
    expect((await store.round("p1"))?.value.finishedAt).toBe(NOON);
  });
});
