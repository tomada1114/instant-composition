import { describePagedVocabStore } from "./vocab-paged-store-contract";
import { describeReadModelStoreContract } from "./read-model-store-contract";
import { describe, expect, it } from "vitest";

import {
  createMemoryDirectory,
  createMemoryStores,
} from "@instant-composition/adapters";
import { learnerId } from "@instant-composition/application";

import { oneOfEach, makeVocabPagedSession } from "./application-fixtures";
import { describeLearnerDirectoryContract } from "./learner-directory-contract";
import { describeCompositionStoreContract } from "./composition-store-contract";
import { describeLearnerStoreContract } from "./learner-store-contract";

describeLearnerStoreContract("the in-memory store", createMemoryStores);
describeLearnerDirectoryContract("the in-memory directory", () => {
  const stores = createMemoryStores();
  return { directory: createMemoryDirectory(stores), stores };
});

describe("the in-memory store", () => {
  it("counts one read per method call, across learners", async () => {
    const stores = createMemoryStores();
    const a = stores.forLearner(learnerId("learner-a"));
    await a.commit({ puts: oneOfEach(), updates: [], expect: [] });

    await a.days(["2026-09-21", "2026-09-22", "2026-09-23"]);
    await a.items();
    await stores.forLearner(learnerId("learner-b")).settings();

    expect(stores.readCount()).toBe(3);
  });
});

describeReadModelStoreContract("the in-memory store", createMemoryStores);
describeCompositionStoreContract("memory", createMemoryStores);

describePagedVocabStore("memory", () => Promise.resolve(createMemoryStores()));

describe("paged vocabulary stored shape budgets", () => {
  it("refuses malformed or oversized header fields instead of admitting unbounded values", async () => {
    const store = createMemoryStores().forLearner(learnerId("bounds"));
    for (const value of [
      makeVocabPagedSession({ day: "2026-09-22-extra" }),
      makeVocabPagedSession({ catalog: "x".repeat(257) }),
      makeVocabPagedSession({ candidateGeneration: "x".repeat(1025) }),
      makeVocabPagedSession({ dueCursor: "x".repeat(4097) }),
      makeVocabPagedSession({ fresh: Array<string>(201).fill("v1") }),
    ]) {
      await expect(
        store.commit({
          puts: [{ type: "vocabPagedSession", value }],
          updates: [],
          expect: [],
        }),
      ).rejects.toThrow();
      expect(await store.vocabPagedSession(value.id)).toBeUndefined();
    }
  });
});
