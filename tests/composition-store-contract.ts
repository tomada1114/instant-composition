import { beforeEach, describe, expect, it } from "vitest";
import {
  learnerId,
  type Entry,
  type LearnerStore,
  type LearnerStores,
} from "@instant-composition/application";
import { addDays } from "@instant-composition/domain";
import { makeDay, makeItem, makePortion } from "./application-fixtures";
import { makeCompositionCandidate } from "./composition-fixtures";

export function describeCompositionStoreContract(
  name: string,
  fresh: () => LearnerStores | Promise<LearnerStores>,
): void {
  describe(`${name}: bounded calendar and maintenance pages`, () => {
    let stores: LearnerStores;
    let store: LearnerStore;
    beforeEach(async () => {
      stores = await fresh();
      store = stores.forLearner(learnerId("calendar-a"));
    });
    it("pages a live generation by primary candidate order and binds cursor/point keys to the learner", async () => {
      const candidates = Array.from({ length: 15 }, (_, at) =>
        makeCompositionCandidate({
          id: `c-${String(at)}`,
          order: String(at).padStart(3, "0"),
          expiresAt: 1800000000,
        }),
      );
      await store.commit({
        puts: [
          ...candidates.map((value): Entry => ({
            type: "compositionCandidate",
            value,
          })),
          {
            type: "compositionCandidate",
            value: makeCompositionCandidate({ generation: "other" }),
          },
          {
            type: "compositionCandidate",
            value: makeCompositionCandidate({ mode: "notDue" }),
          },
        ],
        updates: [],
        expect: [],
      });
      const request = {
        day: "2026-09-22",
        generation: "fixture",
        mode: "due" as const,
        limit: 10,
        cursor: null,
      };
      const page = await store.compositionCandidates(request);
      expect(page.rows.map(({ value }) => value)).toStrictEqual(
        candidates.slice(0, 10),
      );
      expect(
        (
          await store.compositionCandidates({ ...request, cursor: page.cursor })
        ).rows.map(({ value }) => value),
      ).toStrictEqual(candidates.slice(10));
      expect(
        (
          await store.compositionCandidatesByKeys([
            candidates[0] ?? makeCompositionCandidate(),
          ])
        ).size,
      ).toBe(1);
      await expect(async () =>
        stores
          .forLearner(learnerId("calendar-b"))
          .compositionCandidates({ ...request, cursor: page.cursor }),
      ).rejects.toThrow(RangeError);
      await expect(async () =>
        store.compositionCandidates({
          ...request,
          generation: "other",
          cursor: page.cursor,
        }),
      ).rejects.toThrow(RangeError);
      expect(
        (
          await stores
            .forLearner(learnerId("calendar-b"))
            .compositionCandidatesByKeys(candidates)
        ).size,
      ).toBe(0);
    });
    it("pages only the requested range and binds the cursor to its learner and range", async () => {
      const entries: Entry[] = Array.from({ length: 140 }, (_, index) => ({
        type: "portion",
        value: makePortion({ day: addDays("2020-01-01", index), progress: index % 10 }),
      }));
      entries.push(
        { type: "day", value: makeDay() },
        { type: "item", value: makeItem() },
      );
      for (let at = 0; at < entries.length; at += 80)
        expect(
          (
            await store.commit({
              puts: entries.slice(at, at + 80),
              updates: [],
              expect: [],
            })
          ).ok,
        ).toBe(true);
      const range = { from: "2020-01-10", to: "2020-03-31", limit: 25 };
      const first = await store.portionsPage(range);
      expect(first.entries).toHaveLength(25);
      expect(first.cursor).not.toBeNull();
      const cursor = first.cursor ?? "";
      const second = await store.portionsPage({ ...range, cursor });
      expect(second.entries).toHaveLength(25);
      expect(second.entries[0]?.value.day).toBe(addDays("2020-01-10", 25));
      await expect(async () =>
        store.portionsPage({ ...range, from: "2020-01-11", cursor }),
      ).rejects.toThrow(RangeError);
      await expect(async () =>
        stores.forLearner(learnerId("calendar-b")).portionsPage({ ...range, cursor }),
      ).rejects.toThrow(RangeError);
      expect(
        (await stores.forLearner(learnerId("calendar-b")).portionsPage(range)).entries,
      ).toStrictEqual([]);
      const small = await store.portionsPage({
        from: "2020-02-01",
        to: "2020-02-29",
        limit: 100,
      });
      expect(small.entries).toHaveLength(29);
      expect(small.cursor).toBeNull();
    });
    it.each([0, -1, 101, 1.5])("refuses an invalid page limit %s", async (limit) => {
      await expect(async () =>
        store.portionsPage({ from: "2020-01-01", to: "2020-01-31", limit }),
      ).rejects.toThrow(RangeError);
      await expect(async () => store.compositionItemsPage({ limit })).rejects.toThrow(
        RangeError,
      );
    });
    it("returns at most the nearest intervals, excluding unrelated families and learners", async () => {
      await store.commit({
        puts: [
          {
            type: "streakRun",
            value: { schema: 1, start: "2020-01-01", end: "2020-01-20" },
          },
          {
            type: "streakRun",
            value: { schema: 1, start: "2020-02-01", end: "2020-03-01" },
          },
          {
            type: "streakRun",
            value: { schema: 1, start: "2020-04-01", end: "2020-04-02" },
          },
          { type: "day", value: makeDay() },
        ],
        updates: [],
        expect: [],
      });
      expect(
        (await store.streakNeighbours("2020-01-31")).map(({ value }) => value.start),
      ).toStrictEqual(["2020-01-01", "2020-02-01"]);
      expect(
        await stores.forLearner(learnerId("calendar-b")).streakNeighbours("2020-01-31"),
      ).toStrictEqual([]);
    });
  });
}
