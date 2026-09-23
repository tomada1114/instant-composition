import { describe, expect, it } from "vitest";

import {
  createMemoryStores,
  learnerId,
  MAX_COMMIT_ITEMS,
  type Entry,
} from "@instant-composition/application";

import { makeDay, makeReview, oneOfEach } from "./application-fixtures";
import { describeLearnerStoreContract } from "./learner-store-contract";

describeLearnerStoreContract("the in-memory store", createMemoryStores);

describe("the in-memory store", () => {
  const store = () => createMemoryStores().forLearner(learnerId("learner-a"));

  it("refuses a commit larger than DynamoDB's transaction limit", async () => {
    const days: Entry[] = Array.from({ length: MAX_COMMIT_ITEMS + 1 }, (_, index) => ({
      type: "day",
      value: makeDay({ day: `2026-01-${String(index).padStart(3, "0")}` }),
    }));

    await expect(async () =>
      store().commit({ puts: days, updates: [], expect: [] }),
    ).rejects.toThrow(RangeError);
  });

  it("refuses a commit that names one key twice", async () => {
    const entry: Entry = { type: "day", value: makeDay() };

    await expect(async () =>
      store().commit({ puts: [entry], updates: [{ entry, version: 1 }], expect: [] }),
    ).rejects.toThrow(RangeError);
  });

  it("refuses an update of a review entry", async () => {
    const entry: Entry = { type: "review", value: makeReview() };

    await expect(async () =>
      store().commit({ puts: [], updates: [{ entry, version: 1 }], expect: [] }),
    ).rejects.toThrow(RangeError);
  });

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
