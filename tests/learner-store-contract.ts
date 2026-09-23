import { beforeEach, describe, expect, it } from "vitest";

import {
  keyOf,
  learnerId,
  type LearnerStore,
  type LearnerStores,
} from "@instant-composition/application";

import {
  makeReview,
  makeRound,
  makeSettings,
  makeStats,
  oneOfEach,
} from "./application-fixtures";

// The contract every LearnerStores adapter runs: the in-memory one now, the
// DynamoDB one when it lands. Isolation first, then what a commit promises.

const A = learnerId("learner-a");
const B = learnerId("learner-b");

type Read = (store: LearnerStore) => Promise<unknown>;

/**
 * Every read the port offers, pointed at the keys `oneOfEach` writes. Keyed by
 * the port's own method names, so a method added to `LearnerStore` fails to
 * compile here until the isolation case below covers it.
 */
const READS: Readonly<Record<Exclude<keyof LearnerStore, "commit">, Read>> = {
  settings: (store) => store.settings(),
  stats: (store) => store.stats(),
  round: (store) => store.round("r1"),
  reviewsOf: (store) => store.reviewsOf("r1"),
  reviews: (store) => store.reviews(),
  portion: (store) => store.portion("2026-09-22"),
  days: (store) => store.days(["2026-09-22"]),
  items: (store) => store.items(),
};

function isNothing(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return value instanceof Map && value.size === 0;
}

export function describeLearnerStoreContract(
  name: string,
  makeStores: () => LearnerStores,
): void {
  describe(`${name}: learner isolation`, () => {
    let stores: LearnerStores;

    beforeEach(async () => {
      stores = makeStores();
      const written = await stores
        .forLearner(A)
        .commit({ puts: oneOfEach(), updates: [], expect: [] });
      if (!written.ok) {
        throw new Error("Writing learner A's entries failed.");
      }
    });

    it.each(Object.entries(READS))(
      "finds A's data through %s as A",
      async (_, read) => {
        expect(isNothing(await read(stores.forLearner(A)))).toBe(false);
      },
    );

    it.each(Object.entries(READS))(
      "finds nothing of A's through %s as B",
      async (_, read) => {
        expect(isNothing(await read(stores.forLearner(B)))).toBe(true);
      },
    );

    it("leaves A's data unchanged when B writes the same keys", async () => {
      const before = await Promise.all(
        Object.values(READS).map((read) => read(stores.forLearner(A))),
      );
      const other = oneOfEach().map((entry) =>
        entry.type === "settings"
          ? { type: "settings" as const, value: makeSettings({ topics: ["travel"] }) }
          : entry,
      );
      const written = await stores
        .forLearner(B)
        .commit({ puts: other, updates: [], expect: [] });

      expect(written.ok).toBe(true);
      expect(
        await Promise.all(
          Object.values(READS).map((read) => read(stores.forLearner(A))),
        ),
      ).toStrictEqual(before);
      expect((await stores.forLearner(B).settings())?.value.topics).toStrictEqual([
        "travel",
      ]);
    });

    it("refuses B an update of A's entry at A's version", async () => {
      const version = (await stores.forLearner(A).stats())?.version ?? 0;
      const updated = await stores.forLearner(B).commit({
        puts: [],
        updates: [
          { entry: { type: "stats", value: makeStats({ points: 99 }) }, version },
        ],
        expect: [],
      });

      expect(updated).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      expect((await stores.forLearner(A).stats())?.value.points).toBe(0);
    });
  });

  describe(`${name}: commits`, () => {
    let store: LearnerStore;

    beforeEach(() => {
      store = makeStores().forLearner(A);
    });

    it("creates an entry at version 1 and moves it on with each update", async () => {
      await store.commit({
        puts: [{ type: "stats", value: makeStats() }],
        updates: [],
        expect: [],
      });
      expect((await store.stats())?.version).toBe(1);

      const updated = await store.commit({
        puts: [],
        updates: [
          { entry: { type: "stats", value: makeStats({ points: 5 }) }, version: 1 },
        ],
        expect: [],
      });

      expect(updated.ok).toBe(true);
      expect(await store.stats()).toStrictEqual({
        value: makeStats({ points: 5 }),
        version: 2,
      });
    });

    it("refuses a put over an entry that exists", async () => {
      const entry = { type: "round" as const, value: makeRound() };
      await store.commit({ puts: [entry], updates: [], expect: [] });

      expect(
        await store.commit({ puts: [entry], updates: [], expect: [] }),
      ).toStrictEqual({
        ok: false,
        error: { code: "ERR_CONFLICT" },
      });
    });

    it("writes nothing of a commit when one condition fails", async () => {
      await store.commit({
        puts: [{ type: "stats", value: makeStats() }],
        updates: [],
        expect: [],
      });

      const failed = await store.commit({
        puts: [{ type: "round", value: makeRound() }],
        updates: [
          { entry: { type: "stats", value: makeStats({ points: 5 }) }, version: 7 },
        ],
        expect: [],
      });

      expect(failed.ok).toBe(false);
      expect(await store.round("r1")).toBeUndefined();
      expect((await store.stats())?.value.points).toBe(0);
    });

    it("holds a commit to what it expects of entries it does not write", async () => {
      const round = { type: "round" as const, value: makeRound() };
      const absent = { key: keyOf(round), version: null };
      await store.commit({
        puts: [{ type: "stats", value: makeStats() }],
        updates: [],
        expect: [absent],
      });
      await store.commit({ puts: [round], updates: [], expect: [] });

      const stale = await store.commit({
        puts: [{ type: "settings", value: makeSettings() }],
        updates: [],
        expect: [absent],
      });
      const current = await store.commit({
        puts: [{ type: "settings", value: makeSettings() }],
        updates: [],
        expect: [{ key: keyOf(round), version: 1 }],
      });

      expect(stale.ok).toBe(false);
      expect(current.ok).toBe(true);
    });

    it("reads a session's reviews by time and then by id, and no other session's", async () => {
      const reviews = [
        makeReview({ id: "b", answeredAt: 5 }),
        makeReview({ id: "c", answeredAt: 3 }),
        makeReview({ id: "a", answeredAt: 5 }),
        makeReview({ id: "d", sessionId: "r2", answeredAt: 1 }),
      ];
      await store.commit({
        puts: reviews.map((value) => ({ type: "review" as const, value })),
        updates: [],
        expect: [],
      });

      expect((await store.reviewsOf("r1")).map((review) => review.id)).toStrictEqual([
        "c",
        "a",
        "b",
      ]);
      expect((await store.reviews()).map((review) => review.id)).toStrictEqual([
        "d",
        "c",
        "a",
        "b",
      ]);
    });

    it("finds only the days that have a tally", async () => {
      await store.commit({ puts: oneOfEach(), updates: [], expect: [] });

      const days = await store.days(["2026-09-21", "2026-09-22"]);

      expect([...days.keys()]).toStrictEqual(["2026-09-22"]);
    });
  });
}
