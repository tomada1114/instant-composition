import { describe, expect, it } from "vitest";

import { createMemoryStores } from "@instant-composition/adapters";
import { learnerId } from "@instant-composition/application";

import { oneOfEach } from "./application-fixtures";
import { describeLearnerStoreContract } from "./learner-store-contract";

describeLearnerStoreContract("the in-memory store", createMemoryStores);

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
