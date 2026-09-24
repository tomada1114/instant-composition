import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  finishRound,
  recordAnswers,
  startRound,
  updateSettings,
  type ApplicationDeps,
  type LearnerStore,
} from "@instant-composition/application";

import { answersFor, fixedCatalog, makeHarness, NOON } from "./application-harness";
import { localTables } from "./dynamodb-local";
import { describeLearnerStoreContract } from "./learner-store-contract";

// The DynamoDB store against DynamoDB local: the whole contract suite, each
// case on a table of its own, then a command flow through the application.
// Needs `pnpm db:up`; `pnpm test:dynamodb` runs it, never the default suite.

const tables = localTables();

beforeAll(async () => {
  await tables.reachable();
});

afterAll(async () => {
  await tables.close();
});

describeLearnerStoreContract("the DynamoDB store", () => tables.fresh());

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
