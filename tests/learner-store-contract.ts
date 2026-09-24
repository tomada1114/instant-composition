import { beforeEach, describe, expect, it } from "vitest";

import { MAX_COMMIT_ITEMS } from "@instant-composition/adapters";
import {
  keyOf,
  learnerId,
  type Entry,
  type LearnerStore,
  type LearnerStores,
} from "@instant-composition/application";

import {
  makeDay,
  makeItem,
  makePortion,
  makeReview,
  makeRound,
  makeSettings,
  makeStats,
  oneOfEach,
} from "./application-fixtures";

// The contract every LearnerStores adapter runs: the in-memory one and the
// DynamoDB one. Isolation first, then what a commit promises, then the commits
// no store may accept at all.

const A = learnerId("learner-a");
const B = learnerId("learner-b");

const CONFLICT = { ok: false, error: { code: "ERR_CONFLICT" } };

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

/**
 * Runs the contract against the stores `makeStores` builds, a fresh and empty
 * set for every case.
 */
export function describeLearnerStoreContract(
  name: string,
  makeStores: () => LearnerStores | Promise<LearnerStores>,
): void {
  describe(`${name}: learner isolation`, () => {
    let stores: LearnerStores;

    beforeEach(async () => {
      stores = await makeStores();
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

    beforeEach(async () => {
      store = (await makeStores()).forLearner(A);
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

    it("reads back every entry exactly as it was written", async () => {
      await store.commit({ puts: oneOfEach(), updates: [], expect: [] });

      expect(await store.settings()).toStrictEqual({
        value: makeSettings(),
        version: 1,
      });
      expect(await store.stats()).toStrictEqual({ value: makeStats(), version: 1 });
      expect(await store.round("r1")).toStrictEqual({ value: makeRound(), version: 1 });
      expect(await store.reviewsOf("r1")).toStrictEqual([makeReview()]);
      expect(await store.portion("2026-09-22")).toStrictEqual({
        value: makePortion(),
        version: 1,
      });
      expect(await store.days(["2026-09-22"])).toStrictEqual(
        new Map([["2026-09-22", { value: makeDay(), version: 1 }]]),
      );
      expect(await store.items()).toStrictEqual(
        new Map([["c1", { value: makeItem(), version: 1 }]]),
      );
    });

    it("rejects a resent answer by its id and changes nothing", async () => {
      const first = makeReview();
      await store.commit({
        puts: [{ type: "review", value: first }],
        updates: [],
        expect: [],
      });

      const resent = await store.commit({
        puts: [
          { type: "review", value: makeReview({ answeredAt: 9_000 }) },
          { type: "stats", value: makeStats({ said: 1 }) },
        ],
        updates: [],
        expect: [],
      });

      expect(resent).toStrictEqual(CONFLICT);
      expect(await store.reviews()).toStrictEqual([first]);
      expect(await store.stats()).toBeUndefined();
    });

    it("keeps entries apart whatever their ids contain", async () => {
      const reviews = [
        makeReview({ sessionId: "r", id: "x#ANSWER#y" }),
        makeReview({ sessionId: "r#ANSWER#x", id: "y" }),
      ];
      const written = await store.commit({
        puts: [
          ...reviews.map((value) => ({ type: "review" as const, value })),
          { type: "round", value: makeRound({ id: "r#ANSWER#z" }) },
        ],
        updates: [],
        expect: [],
      });

      expect(written.ok).toBe(true);
      expect(await store.reviewsOf("r")).toStrictEqual([reviews[0]]);
      expect(await store.reviewsOf("r#ANSWER#x")).toStrictEqual([reviews[1]]);
      expect((await store.reviews()).map((review) => review.id).sort()).toStrictEqual([
        "x#ANSWER#y",
        "y",
      ]);
    });

    it("applies a commit that only expects, and writes nothing for it", async () => {
      const stats = { type: "stats" as const, value: makeStats() };
      await store.commit({ puts: [stats], updates: [], expect: [] });

      const holding = await store.commit({
        puts: [],
        updates: [],
        expect: [
          { key: keyOf(stats), version: 1 },
          { key: { type: "settings" }, version: null },
        ],
      });
      const stale = await store.commit({
        puts: [],
        updates: [],
        expect: [{ key: keyOf(stats), version: 2 }],
      });

      expect(holding.ok).toBe(true);
      expect(stale).toStrictEqual(CONFLICT);
      expect(await store.settings()).toBeUndefined();
      expect((await store.stats())?.version).toBe(1);
    });

    it("accepts an empty commit", async () => {
      expect(await store.commit({ puts: [], updates: [], expect: [] })).toStrictEqual({
        ok: true,
        value: undefined,
      });
    });
  });

  describe(`${name}: commits no store may apply`, () => {
    let store: LearnerStore;

    beforeEach(async () => {
      store = (await makeStores()).forLearner(A);
    });

    it("refuses a commit larger than DynamoDB's transaction limit", async () => {
      const days: Entry[] = Array.from(
        { length: MAX_COMMIT_ITEMS + 1 },
        (_, index) => ({
          type: "day",
          value: makeDay({ day: `2026-01-${String(index).padStart(3, "0")}` }),
        }),
      );

      await expect(async () =>
        store.commit({ puts: days, updates: [], expect: [] }),
      ).rejects.toThrow(RangeError);
      expect(await store.days(["2026-01-000"])).toStrictEqual(new Map());
    });

    it("accepts a commit of exactly the transaction limit", async () => {
      const days: Entry[] = Array.from({ length: MAX_COMMIT_ITEMS }, (_, index) => ({
        type: "day",
        value: makeDay({ day: `2026-01-${String(index).padStart(3, "0")}` }),
      }));

      expect((await store.commit({ puts: days, updates: [], expect: [] })).ok).toBe(
        true,
      );
      expect((await store.days(["2026-01-000", "2026-01-099"])).size).toBe(2);
    });

    it("refuses a commit that names one key twice", async () => {
      const entry: Entry = { type: "day", value: makeDay() };

      await expect(async () =>
        store.commit({ puts: [entry], updates: [{ entry, version: 1 }], expect: [] }),
      ).rejects.toThrow(RangeError);
    });

    it("refuses an update of a review entry", async () => {
      const entry: Entry = { type: "review", value: makeReview() };

      await expect(async () =>
        store.commit({ puts: [], updates: [{ entry, version: 1 }], expect: [] }),
      ).rejects.toThrow(RangeError);
    });
  });
}
