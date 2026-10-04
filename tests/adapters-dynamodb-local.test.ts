import { describeRawReadModelContract } from "./raw-read-model-contract";
import { describePagedVocabStore } from "./vocab-paged-store-contract";
import { describeReadModelStoreContract } from "./read-model-store-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createDynamoDbStores,
  createDynamoDbReadModelMaintenance,
  createDynamoDbReadModelBootstrapStorage,
  executeStorageMaintenance,
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
  StorageSchemaError,
  STORAGE_SCHEMA_VERSION,
} from "@instant-composition/adapters";

import {
  finishRound,
  DEFAULT_PROFILE,
  learnerId,
  vocabHub,
  recordAnswers,
  startRound,
  updateSettings,
  startTalk,
  type ApplicationDeps,
  type LearnerStore,
} from "@instant-composition/application";

import { answersFor, fixedCatalog, makeHarness, NOON } from "./application-harness";
import {
  makeProfile,
  makeSettings,
  makeTalk,
  makeReview,
  makeVocabPagedSession,
} from "./application-fixtures";
import {
  createReadModelWorkerHandler,
  readModelBootstrapValidity,
  runReadModelWorker,
} from "@instant-composition/api";
import { localTables } from "./dynamodb-local";
import { describeLearnerDirectoryContract } from "./learner-directory-contract";
import { describeCompositionStoreContract } from "./composition-store-contract";
import { describeLearnerStoreContract } from "./learner-store-contract";
import { describeBoundedAnswerContract } from "./bounded-answer-contract";
import { describeModelTaskContract } from "./model-task-contract";
import { describeFirstAnswerContract } from "./first-answer-contract";
import { describeVocabCardDeletionContract } from "./vocab-card-deletion-contract";
import { makeTalkHarness } from "./application-talk-harness";
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

const pagedWire: string[] = [];
const tables = localTables((operation, body) => {
  if (operation.includes("TransactWrite") || body.includes('"TransactItems"'))
    pagedWire.push(body);
});

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

describeReadModelStoreContract("the DynamoDB store", () => tables.fresh());

describe("the independent worker with DynamoDB", () => {
  it("discovers a new registration through the registry and keeps profile changes current", async () => {
    const backing = await tables.freshMaintenance();
    const h = makeHarness();
    expect(
      (
        await backing.directory.register("worker-subject", {
          learnerId: h.learner,
          profile: DEFAULT_PROFILE,
        })
      ).ok,
    ).toBe(true);
    expect((await backing.maintenance.profiles(null)).learners).toStrictEqual([
      { id: h.learner, profile: DEFAULT_PROFILE },
    ]);
    const beforeHistory = await backing.maintenance.profiles(null);
    const learnerStore = backing.stores.forLearner(h.learner);
    for (let offset = 0; offset < 600; offset += 100)
      await learnerStore.commit({
        puts: Array.from({ length: 100 }, (_, index) => ({
          type: "review" as const,
          value: makeReview({
            id: `history-${String(offset + index)}`,
            sessionId: "unrelated",
          }),
        })),
        updates: [],
        expect: [],
      });
    expect(await backing.maintenance.profiles(null)).toStrictEqual(beforeHistory);
    const deps = { stores: backing.stores, catalog: fixedCatalog() };
    expect((await runReadModelWorker(deps, backing.maintenance, NOON)).rows).toBe(80);
    expect((await vocabHub(deps, h.context())).ok).toBe(true);
    const store = backing.stores.forLearner(h.learner);
    const profile = await store.profile();
    if (profile === undefined) throw new Error("No registered fixture profile.");
    const changed = { ...profile.value, timeZone: "Europe/London" };
    expect(
      (
        await store.commit({
          puts: [],
          updates: [
            { entry: { type: "profile", value: changed }, version: profile.version },
          ],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    expect((await backing.maintenance.profiles(null)).learners).toStrictEqual([
      { id: h.learner, profile: changed },
    ]);
    expect(
      await backing.stores.forLearner(learnerId("other")).vocabReadModel("2026-09-22"),
    ).toBeUndefined();
  });
});
describeCompositionStoreContract("DynamoDB", () => tables.fresh());

const rawReadModelClient = localDynamoDbClient("http://127.0.0.1:8000");
const rawReadModelTables: string[] = [];
afterAll(async () => {
  await Promise.all(
    rawReadModelTables.map((table) => deleteLearnerTable(rawReadModelClient, table)),
  );
  rawReadModelClient.destroy();
});
describeRawReadModelContract("DynamoDB local", async (rows) => {
  const tableName = `raw-read-model-${randomUUID()}`;
  await createLearnerTable(rawReadModelClient, tableName);
  rawReadModelTables.push(tableName);
  for (const row of rows)
    await rawLocal("PutItem", { TableName: tableName, Item: wireRow(row) });
  const options = { client: rawReadModelClient, tableName };
  return {
    stores: createDynamoDbStores(options),
    maintenance: createDynamoDbReadModelMaintenance(options),
  };
});

describe("raw global preimage races with DynamoDB", () => {
  it.each(["schema", "value", "version", "expiry", "profile"] as const)(
    "preserves every learner/global sibling on a same-version %s mutation",
    async (change) => {
      const client = localDynamoDbClient("http://127.0.0.1:8000"),
        tableName = `global-race-${randomUUID()}`;
      await createLearnerTable(client, tableName);
      try {
        const store = createDynamoDbStores({ client, tableName }).forLearner(
          learnerId("a"),
        );
        expect(
          (
            await store.commit({
              puts: [{ type: "profile", value: makeProfile() }],
              updates: [],
              expect: [],
            })
          ).ok,
        ).toBe(true);
        const registryKey = { PK: "SYSTEM#READMODEL_LEARNERS", SK: "a" };
        const key =
          change === "profile" ? { PK: "LEARNER#a", SK: "PROFILE" } : registryKey;
        const replacement = {
          ...key,
          type: change === "profile" ? "profile" : "readModelLearner",
          version: change === "version" ? 2 : 1,
          schemaVersion: change === "schema" ? 5 : 4,
          value:
            change === "profile"
              ? makeProfile({ timeZone: "Europe/Paris" })
              : {
                  schema: 1,
                  id: "a",
                  profile: makeProfile({
                    timeZone: change === "value" ? "Europe/Paris" : "Asia/Tokyo",
                  }),
                },
          ...(change === "expiry" ? { expiresAt: 123 } : {}),
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
          { step: "initialize", name: "changeRawGlobalPreimageAfterStrongRead" },
        );
        expect(
          await store.commit({
            puts: [{ type: "settings", value: makeSettings() }],
            updates: [
              {
                entry: {
                  type: "profile",
                  value: makeProfile({ timeZone: "America/Los_Angeles" }),
                },
                version: 1,
              },
            ],
            expect: [],
          }),
        ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
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
        expect(await store.settings()).toBeUndefined();
        expect(await store.profile()).toStrictEqual({
          value:
            change === "profile"
              ? makeProfile({ timeZone: "Europe/Paris" })
              : makeProfile(),
          version: 1,
        });
      } finally {
        await deleteLearnerTable(client, tableName);
        client.destroy();
      }
    },
  );
  it("preserves a maintenance replacement made after its strong preflight", async () => {
    const client = localDynamoDbClient("http://127.0.0.1:8000"),
      tableName = `checkpoint-race-${randomUUID()}`;
    await createLearnerTable(client, tableName);
    try {
      const maintenance = createDynamoDbReadModelMaintenance({ client, tableName });
      const value = {
        schema: 1 as const,
        cursor: null,
        pending: [],
        index: 1,
        passCompletedAt: 1000,
      };
      expect((await maintenance.save(value, null)).ok).toBe(true);
      const key = { PK: "SYSTEM#READMODEL", SK: "CHECKPOINT" };
      const replacement = {
        ...key,
        type: "readModelMaintenance",
        version: 1,
        schemaVersion: 4,
        value: { ...value, passCompletedAt: 2000 },
      };
      let injected = false;
      client.middlewareStack.add(
        (next) => async (args) => {
          if (!injected && "Item" in args.input) {
            injected = true;
            await rawLocal("PutItem", {
              TableName: tableName,
              Item: wireRow(replacement),
            });
          }
          return next(args);
        },
        { step: "initialize", name: "changeSystemCheckpointAfterStrongRead" },
      );
      expect(
        await maintenance.save({ ...value, passCompletedAt: 3000 }, 1),
      ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      expect(injected).toBe(true);
      expect(await maintenance.checkpoint()).toStrictEqual({
        value: replacement.value,
        version: 1,
      });
    } finally {
      await deleteLearnerTable(client, tableName);
      client.destroy();
    }
  });
  it.each([false, true])(
    "preserves historical top-level TTL presence %s through explicit cap4 maintenance",
    async (present) => {
      const client = localDynamoDbClient("http://127.0.0.1:8000"),
        tableName = `ttl-history-${randomUUID()}`;
      await createLearnerTable(client, tableName);
      try {
        const key = { PK: "LEARNER#a", SK: "TALK#t1" },
          value = makeTalk({ expiresAt: 123 });
        const source = {
          ...key,
          type: "talk",
          version: 1,
          schemaVersion: 3,
          value,
          ...(present ? { expiresAt: 123 } : {}),
        };
        await rawLocal("PutItem", { TableName: tableName, Item: wireRow(source) });
        expect(
          await executeStorageMaintenance({
            table: tableName,
            region: "ap-northeast-1",
            endpoint: "http://127.0.0.1:8000",
            command: "replace",
            key,
            row: { ...source, version: 2, schemaVersion: STORAGE_SCHEMA_VERSION },
            version: 1,
            schema: 3,
          }),
        ).toBe(true);
        expect(
          readKey(
            await rawLocal("GetItem", {
              TableName: tableName,
              Key: wireRow(key),
              ConsistentRead: true,
            }),
            "Item",
          ),
        ).toStrictEqual(
          wireRow({ ...source, version: 2, schemaVersion: STORAGE_SCHEMA_VERSION }),
        );
      } finally {
        await deleteLearnerTable(client, tableName);
        client.destroy();
      }
    },
  );
  it("resumes the actual durable factory through fresh hosted handlers with null checkpoints", async () => {
    const client = localDynamoDbClient("http://127.0.0.1:8000"),
      tableName = `hosted-bootstrap-${randomUUID()}`;
    await createLearnerTable(client, tableName);
    try {
      const options = { client, tableName },
        h = makeHarness();
      const deps = { stores: createDynamoDbStores(options), catalog: fixedCatalog() };
      await deps.stores.forLearner(h.learner).commit({
        puts: [{ type: "profile", value: makeProfile() }],
        updates: [],
        expect: [],
      });
      const storage = createDynamoDbReadModelBootstrapStorage(options),
        release = {
          sha: "a".repeat(40),
          contract: "storage-v4",
          schemaFingerprint: "b".repeat(64),
        };
      let discoveries = 0,
        closed = 0;
      const fresh = () =>
        createReadModelWorkerHandler(() => ({
          deps,
          maintenance: createDynamoDbReadModelMaintenance(options),
          storage,
          backfill: () => {
            discoveries += 1;
            return Promise.resolve({ cursor: null, rows: 1 });
          },
          ready: (context) => readModelBootstrapValidity(deps, context),
          now: NOON,
          close: () => {
            closed += 1;
          },
        }));
      const step = () =>
        fresh()(
          { storageBootstrap: true, checkpoint: null },
          { storageRelease: release },
        );
      expect(await step()).toMatchObject({ complete: false, phase: "preparation" });
      expect(await step()).toMatchObject({ complete: false, phase: "verification" });
      expect(await step()).toMatchObject({
        complete: true,
        phase: "verification",
        checkpoint: null,
      });
      expect(await step()).toMatchObject({
        complete: true,
        phase: "verification",
        checkpoint: null,
      });
      expect(discoveries).toBe(1);
      expect(closed).toBe(4);
      expect((await storage.checkpoint())?.value.release).toStrictEqual(release);
    } finally {
      await deleteLearnerTable(client, tableName);
      client.destroy();
    }
  });
});

describePagedVocabStore("DynamoDB Local", () => tables.fresh(), pagedWire);

describe("paged immutable deck preimage fences with DynamoDB", () => {
  it.each(["schema", "membership"] as const)(
    "preserves every sibling on same-version %s replacement after preflight",
    async (change) => {
      const client = localDynamoDbClient("http://127.0.0.1:8000");
      const tableName = `paged-race-${randomUUID()}`;
      await createLearnerTable(client, tableName);
      try {
        const store = createDynamoDbStores({ client, tableName }).forLearner(
          learnerId("paged-race"),
        );
        const header = makeVocabPagedSession();
        const deck = {
          sessionId: "s1",
          generation: 1,
          page: 0,
          cards: [{ id: "v1", isNew: false }],
        };
        expect(
          (
            await store.commit({
              puts: [
                { type: "vocabPagedSession", value: header },
                { type: "vocabDeckPage", value: deck },
              ],
              updates: [],
              expect: [],
            })
          ).ok,
        ).toBe(true);
        const key = { PK: "LEARNER#paged-race", SK: "VOCAB_PAGED#s1#GEN#1#DECK#0" };
        const replacement = {
          ...key,
          type: "vocabDeckPage",
          version: 1,
          schemaVersion:
            change === "schema" ? STORAGE_SCHEMA_VERSION + 1 : STORAGE_SCHEMA_VERSION,
          value:
            change === "membership"
              ? { ...deck, cards: [{ id: "raced", isNew: false }] }
              : deck,
        };
        let raced = false;
        client.middlewareStack.add(
          (next, context) => async (args) => {
            if (!raced && context.commandName?.includes("TransactWrite") === true) {
              raced = true;
              await rawLocal("PutItem", {
                TableName: tableName,
                Item: wireRow(replacement),
              });
            }
            return next(args);
          },
          { step: "finalizeRequest", name: "replaceOwnedPagedDeckAfterPreflight" },
        );
        expect(
          await store.commit({
            puts: [
              {
                type: "vocabSessionGuard",
                value: { id: "companion", finishedAt: null },
              },
            ],
            updates: [
              {
                entry: { type: "vocabPagedSession", value: { ...header, answered: 1 } },
                version: 1,
              },
            ],
            expect: [
              {
                key: { type: "vocabDeckPage", sessionId: "s1", generation: 1, page: 0 },
                version: 1,
              },
            ],
          }),
        ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
        expect(raced).toBe(true);
        expect(await store.vocabPagedSession("s1")).toStrictEqual({
          value: header,
          version: 1,
        });
        expect(await store.vocabSessionGuard("companion")).toBeUndefined();
        expect(
          readKey(
            await rawLocal("GetItem", { TableName: tableName, Key: wireRow(key) }),
            "Item",
          ),
        ).toStrictEqual(wireRow(replacement));
      } finally {
        await deleteLearnerTable(client, tableName);
        client.destroy();
      }
    },
  );
});
