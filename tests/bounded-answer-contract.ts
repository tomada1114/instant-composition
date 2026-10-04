import { prepareVocabReadModels } from "./read-model-harness";
import { describe, expect, it } from "vitest";

import {
  finishRound,
  finishVocabSession,
  recordAnswers,
  recordVocabAnswers,
  type ApplicationDeps,
  type Entry,
  type LearnerStore,
  type LearnerStores,
} from "@instant-composition/application";
import type { AnswerInput, VocabAnswer } from "@instant-composition/domain";

import {
  makeDay,
  makeItem,
  makePersonalCard,
  makePortion,
  makeReview,
  makeRound,
  makeStats,
  makeVocabProgress,
  makeVocabReview,
  makeVocabSession,
} from "./application-fixtures";
import { fixedCatalog, makeHarness, makeSnapshot, NOON } from "./application-harness";

const h = makeHarness();
const snapshot = makeSnapshot();
const CARD = [...snapshot.shown.keys()][0] ?? "missing";

function first(id: string): AnswerInput {
  return {
    id,
    roundId: "r1",
    cardId: CARD,
    pass: "first",
    result: "ok",
    elapsedMs: 1_000,
  };
}
function vocab(id: string, cardId = "p_target"): VocabAnswer {
  return { id, cardId, pass: "first", grade: "good", elapsedMs: 1_000 };
}
async function put(store: LearnerStore, entries: readonly Entry[]): Promise<void> {
  for (let start = 0; start < entries.length; start += 50) {
    expect(
      (
        await store.commit({
          puts: entries.slice(start, start + 50),
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
  }
}
function bounded(stores: LearnerStores, counts: number[]): LearnerStores {
  const forbidden = (): never => {
    throw new Error("An answer enumerated unrelated data.");
  };
  return {
    forLearner(id) {
      const store = stores.forLearner(id);
      async function counted<T>(
        keys: readonly string[],
        read: () => Promise<ReadonlyMap<string, T>>,
      ): Promise<ReadonlyMap<string, T>> {
        const offset = counts.length;
        counts.push(new Set(keys).size, 0);
        const rows = await read();
        counts[offset + 1] = rows.size;
        return rows;
      }
      return {
        ...store,
        items: forbidden,
        vocabItems: forbidden,
        cards: forbidden,
        reviewsOf: forbidden,
        vocabReviewsOf: forbidden,
        reviewPage: forbidden,
        itemsByIds: (ids) => counted(ids, () => store.itemsByIds(ids)),
        reviewsByIds: (session, ids) =>
          counted(ids, () => store.reviewsByIds(session, ids)),
        vocabItemsByIds: (ids) => counted(ids, () => store.vocabItemsByIds(ids)),
        vocabReviewsByIds: (session, ids) =>
          counted(ids, () => store.vocabReviewsByIds(session, ids)),
        cardsByIds: (ids) => counted(ids, () => store.cardsByIds(ids)),
      };
    },
  };
}
function race(stores: LearnerStores): LearnerStores {
  let arrivals = 0;
  let release: () => void = () => undefined;
  const barrier = new Promise<void>((done) => {
    release = done;
  });
  return {
    forLearner(id) {
      const store = stores.forLearner(id);
      return {
        ...store,
        async commit(commit) {
          arrivals += 1;
          if (arrivals <= 2) {
            if (arrivals === 2) release();
            await barrier;
          }
          return store.commit(commit);
        },
      };
    },
  };
}

/** Key-only answer writes and compatibility, shared by memory and DynamoDB local. */
export function describeBoundedAnswerContract(
  name: string,
  makeStores: () => LearnerStores | Promise<LearnerStores>,
): void {
  async function ready(): Promise<ApplicationDeps> {
    const stores = await makeStores();
    await put(stores.forLearner(h.learner), [
      { type: "round", value: makeRound({ deck: [CARD], startedAt: NOON }) },
      { type: "stats", value: makeStats() },
      { type: "day", value: makeDay() },
      { type: "portion", value: makePortion() },
      {
        type: "vocabSession",
        value: makeVocabSession({ deck: ["p_target"], startedAt: NOON }),
      },
      { type: "card", value: makePersonalCard({ id: "p_target" }) },
    ]);
    const deps = { stores, catalog: fixedCatalog(snapshot) };
    await prepareVocabReadModels(deps, h.context());
    return deps;
  }
  describe(`${name}: bounded answer reads`, () => {
    it.each([1, 20])(
      "reads the same targeted drill rows for %i answers despite unrelated progress and session logs",
      async (size) => {
        const observed: number[][] = [];
        for (const noise of [0, 120]) {
          const deps = await ready();
          const store = deps.stores.forLearner(h.learner);
          await put(
            store,
            Array.from({ length: noise }, (_, index): Entry[] => [
              {
                type: "item",
                value: makeItem({
                  item: { kind: "composition", id: `other-${String(index)}` },
                }),
              },
              {
                type: "review",
                value: makeReview({
                  id: `history-${String(index)}`,
                  detail: { ...makeReview().detail, pass: "retry" },
                }),
              },
            ]).flat(),
          );
          const counts: number[] = [];
          const keyed = { ...deps, stores: bounded(deps.stores, counts) };
          expect(
            (
              await recordAnswers(keyed, h.context(), {
                roundId: "r1",
                answers: Array.from({ length: size }, (_, index) => ({
                  ...first(`new-${String(index)}`),
                  pass: "retry" as const,
                })),
              })
            ).ok,
          ).toBe(true);
          observed.push(counts);
          expect((await store.reviewsByIds("r1", ["new-0", "absent"])).size).toBe(1);
        }
        expect(observed[1]).toStrictEqual(observed[0]);
        const counts = observed[0] ?? [];
        expect(
          counts.filter((_, at) => at % 2 === 0).reduce((sum, count) => sum + count, 0),
        ).toBe(size === 1 ? 2 : 210);
        expect(
          counts.filter((_, at) => at % 2 === 1).reduce((sum, count) => sum + count, 0),
        ).toBe(size === 1 ? 0 : 90);
        expect(counts).toHaveLength(size === 1 ? 4 : 40);
      },
    );
    it.each([1, 20])(
      "reads only %i personal cards and progress rows despite unrelated vocabulary data",
      async (size) => {
        const observed: number[][] = [];
        for (const noise of [0, 120]) {
          const deps = await ready();
          const store = deps.stores.forLearner(h.learner);
          await put(
            store,
            Array.from({ length: noise }, (_, index): Entry[] => [
              {
                type: "vocabItem",
                value: makeVocabProgress({ cardId: `other-${String(index)}` }),
              },
              {
                type: "vocabReview",
                value: makeVocabReview({ id: `history-${String(index)}` }),
              },
              {
                type: "card",
                value: makePersonalCard({ id: `other-${String(index)}` }),
              },
            ]).flat(),
          );
          const counts: number[] = [];
          expect(
            (
              await recordVocabAnswers(
                { ...deps, stores: bounded(deps.stores, counts) },
                h.context(),
                {
                  sessionId: "s1",
                  answers: Array.from({ length: size }, (_, index) => ({
                    ...vocab(`new-${String(index)}`),
                    pass: "retry" as const,
                  })),
                },
              )
            ).ok,
          ).toBe(true);
          observed.push(counts);
        }
        expect(observed[1]).toStrictEqual(observed[0]);
        const counts = observed[0] ?? [];
        expect(
          counts.filter((_, at) => at % 2 === 0).reduce((sum, count) => sum + count, 0),
        ).toBe(size === 1 ? 3 : 220);
        expect(
          counts.filter((_, at) => at % 2 === 1).reduce((sum, count) => sum + count, 0),
        ).toBe(size === 1 ? 1 : 100);
        expect(counts).toHaveLength(size === 1 ? 6 : 60);
      },
    );
    it("accepts a maximum distinct legacy-result drill batch, each answer only once", async () => {
      const deps = await ready();
      const store = deps.stores.forLearner(h.learner);
      const round = await store.round("r1");
      const deck = [...snapshot.shown.keys()].slice(0, 60);
      expect(
        (
          await store.commit({
            puts: [],
            updates: [
              {
                entry: { type: "round", value: makeRound({ deck }) },
                version: round?.version ?? 0,
              },
            ],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      const answers = deck.map((cardId, index) => ({
        ...first(`old-${String(index)}`),
        cardId,
      }));
      const keyed = { ...deps, stores: bounded(deps.stores, []) };
      expect(
        (await recordAnswers(keyed, h.context(), { roundId: "r1", answers })).ok,
      ).toBe(true);
      expect(
        (await recordAnswers(keyed, h.context(), { roundId: "r1", answers })).ok,
      ).toBe(true);
      expect(await store.reviewsOf("r1")).toHaveLength(60);
      expect((await store.round("r1"))?.value.firstPass).toBe(60);
    });
    it.each([60, 100])(
      "accepts an older or maximum vocabulary batch of %i and its recorded ids after finish",
      async (size) => {
        const deps = await ready();
        const answers = Array.from({ length: size }, (_, index) =>
          vocab(`batch-${String(index)}`),
        );
        const command = { sessionId: "s1", answers };
        const keyed = { ...deps, stores: bounded(deps.stores, []) };
        expect((await recordVocabAnswers(keyed, h.context(), command)).ok).toBe(true);
        expect((await finishVocabSession(deps, h.context(), command)).ok).toBe(true);
        const store = deps.stores.forLearner(h.learner);
        const before = await store.vocabItemsByIds(["p_target"]);
        expect((await recordVocabAnswers(keyed, h.context(), command)).ok).toBe(true);
        expect(await store.vocabItemsByIds(["p_target"])).toStrictEqual(before);
        expect(await store.vocabReviewsOf("s1")).toHaveLength(size);
        expect(
          await recordVocabAnswers(keyed, h.context(), {
            sessionId: "s1",
            answers: [vocab("new-after-finish")],
          }),
        ).toStrictEqual({ ok: false, error: { code: "ERR_SESSION_CLOSED" } });
      },
    );
    it("keeps concurrent vocabulary resends to one immutable answer", async () => {
      const deps = await ready();
      const raced = { ...deps, stores: race(deps.stores) };
      const command = { sessionId: "s1", answers: [vocab("one")] };
      expect(
        await Promise.all([
          recordVocabAnswers(raced, h.context(), command),
          recordVocabAnswers(raced, h.context(), command),
        ]),
      ).toStrictEqual([
        { ok: true, value: undefined },
        { ok: true, value: undefined },
      ]);
      const store = deps.stores.forLearner(h.learner);
      const before = await store.vocabItemsByIds(["p_target"]);
      expect((await recordVocabAnswers(deps, h.context(), command)).ok).toBe(true);
      expect(await store.vocabItemsByIds(["p_target"])).toStrictEqual(before);
      expect(await store.vocabReviewsOf("s1")).toHaveLength(1);
    });
    it.each(["drill", "vocabulary"] as const)(
      "refuses a fresh %s answer when finish wins its version condition",
      async (activity) => {
        const deps = await ready();
        let waiting = true;
        const stores: LearnerStores = {
          forLearner(id) {
            const store = deps.stores.forLearner(id);
            return {
              ...store,
              async commit(commit) {
                if (waiting) {
                  waiting = false;
                  const finished =
                    activity === "drill"
                      ? await finishRound(deps, h.context(), {
                          roundId: "r1",
                          answers: [],
                        })
                      : await finishVocabSession(deps, h.context(), {
                          sessionId: "s1",
                          answers: [],
                        });
                  expect(finished.ok).toBe(true);
                }
                return store.commit(commit);
              },
            };
          },
        };
        const recorded =
          activity === "drill"
            ? await recordAnswers({ ...deps, stores }, h.context(), {
                roundId: "r1",
                answers: [first("late")],
              })
            : await recordVocabAnswers({ ...deps, stores }, h.context(), {
                sessionId: "s1",
                answers: [vocab("late")],
              });
        expect(recorded).toStrictEqual({
          ok: false,
          error: {
            code: activity === "drill" ? "ERR_ROUND_CLOSED" : "ERR_SESSION_CLOSED",
          },
        });
        expect(
          (await deps.stores.forLearner(h.learner).reviewsByIds("r1", ["late"])).size,
        ).toBe(0);
        expect(
          (await deps.stores.forLearner(h.learner).vocabReviewsByIds("s1", ["late"]))
            .size,
        ).toBe(0);
      },
    );
    it.each(["drill", "vocabulary"] as const)(
      "reloads %s retry snapshots when another session advances the same card",
      async (activity) => {
        const deps = await ready();
        const store = deps.stores.forLearner(h.learner);
        const initial =
          activity === "drill"
            ? await recordAnswers(deps, h.context(), {
                roundId: "r1",
                answers: [first("original")],
              })
            : await recordVocabAnswers(deps, h.context(), {
                sessionId: "s1",
                answers: [vocab("original")],
              });
        expect(initial.ok).toBe(true);
        await put(store, [
          {
            type: "round",
            value: makeRound({
              id: "r2",
              deck: [CARD],
              day: "2026-09-23",
              startedAt: NOON,
            }),
          },
          {
            type: "vocabSession",
            value: makeVocabSession({
              id: "s2",
              deck: ["p_target"],
              day: "2026-09-23",
              startedAt: NOON,
            }),
          },
        ]);
        let waiting = true;
        const stores: LearnerStores = {
          forLearner(id) {
            const inner = deps.stores.forLearner(id);
            return {
              ...inner,
              async commit(commit) {
                if (waiting) {
                  waiting = false;
                  const moved =
                    activity === "drill"
                      ? await recordAnswers(deps, h.context(NOON + 86_400_000), {
                          roundId: "r2",
                          answers: [{ ...first("next-day"), roundId: "r2" }],
                        })
                      : await recordVocabAnswers(deps, h.context(NOON + 86_400_000), {
                          sessionId: "s2",
                          answers: [vocab("next-day")],
                        });
                  expect(moved.ok).toBe(true);
                }
                return inner.commit(commit);
              },
            };
          },
        };
        const recorded =
          activity === "drill"
            ? await recordAnswers({ ...deps, stores }, h.context(NOON + 86_400_000), {
                roundId: "r1",
                answers: [{ ...first("retry"), pass: "retry" }],
              })
            : await recordVocabAnswers(
                { ...deps, stores },
                h.context(NOON + 86_400_000),
                { sessionId: "s1", answers: [{ ...vocab("retry"), pass: "retry" }] },
              );
        expect(recorded.ok).toBe(true);
        const review =
          activity === "drill"
            ? (await store.reviewsByIds("r1", ["retry"])).get("retry")?.value.fsrs
                ?.before
            : (await store.vocabReviewsByIds("s1", ["retry"])).get("retry")?.value
                .before;
        expect(review).toMatchObject({ reps: 2, lastDay: "2026-09-23" });
      },
    );
    it("initializes an old adopted round once in bounded pages, preserving every legacy log", async () => {
      const deps = await ready();
      const store = deps.stores.forLearner(h.learner);
      const round = await store.round("r1");
      expect(
        (
          await store.commit({
            puts: [],
            updates: [
              {
                entry: {
                  type: "round",
                  value: makeRound({ deck: [CARD], firstPass: 1 }),
                },
                version: round?.version ?? 0,
              },
            ],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      const reviews = Array.from({ length: 65 }, (_, index) =>
        makeReview({
          id: `legacy-${String(index).padStart(2, "0")}`,
          item: { kind: "composition", id: CARD },
          detail: { ...makeReview().detail, pass: index === 64 ? "first" : "retry" },
        }),
      );
      await put(
        store,
        reviews.map((value): Entry => ({ type: "review", value })),
      );
      const pages: number[] = [];
      const stores: LearnerStores = {
        forLearner(id) {
          const inner = deps.stores.forLearner(id);
          return {
            ...inner,
            async reviewPage(sessionId, cursor) {
              const page = await inner.reviewPage(sessionId, cursor);
              pages.push(page.entries.length);
              return page;
            },
          };
        },
      };
      expect(
        (
          await recordAnswers({ ...deps, stores }, h.context(), {
            roundId: "r1",
            answers: [first("duplicate")],
          })
        ).ok,
      ).toBe(true);
      expect(pages).toStrictEqual([32, 32, 1]);
      expect((await store.round("r1"))?.value.answerState).toStrictEqual({
        firstCards: [CARD],
        cursor: null,
        complete: true,
      });
      expect(await store.reviewsOf("r1")).toStrictEqual(reviews);
      expect(
        (
          await recordAnswers(
            { ...deps, stores: bounded(deps.stores, []) },
            h.context(),
            { roundId: "r1", answers: [first("later-duplicate")] },
          )
        ).ok,
      ).toBe(true);
      expect((await store.round("r1"))?.value.firstPass).toBe(1);
    });
    it("resumes a failed legacy initialization from its atomic checkpoint", async () => {
      const deps = await ready();
      const store = deps.stores.forLearner(h.learner);
      const round = await store.round("r1");
      expect(
        (
          await store.commit({
            puts: [],
            updates: [
              {
                entry: {
                  type: "round",
                  value: makeRound({ deck: [CARD], firstPass: 1 }),
                },
                version: round?.version ?? 0,
              },
            ],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      await put(
        store,
        Array.from({ length: 40 }, (_, index): Entry => ({
          type: "review",
          value: makeReview({
            id: `legacy-${String(index).padStart(2, "0")}`,
            item: { kind: "composition", id: CARD },
          }),
        })),
      );
      let calls = 0;
      const stores: LearnerStores = {
        forLearner(id) {
          const inner = deps.stores.forLearner(id);
          return {
            ...inner,
            reviewPage(sessionId, cursor) {
              calls += 1;
              if (calls === 2) throw new Error("Storage is unavailable.");
              return inner.reviewPage(sessionId, cursor);
            },
          };
        },
      };
      await expect(
        recordAnswers({ ...deps, stores }, h.context(), {
          roundId: "r1",
          answers: [first("pending")],
        }),
      ).rejects.toThrow(Error);
      expect((await store.round("r1"))?.value.answerState).toMatchObject({
        complete: false,
        cursor: "ROUND#r1#ANSWER#legacy-31",
      });
      expect((await store.reviewsByIds("r1", ["pending"])).size).toBe(0);
      expect(
        (
          await recordAnswers({ ...deps, stores }, h.context(), {
            roundId: "r1",
            answers: [first("pending")],
          })
        ).ok,
      ).toBe(true);
      expect(calls).toBe(3);
      expect(await store.reviewsOf("r1")).toHaveLength(40);
    });
    it("lets concurrent legacy initializers keep one complete adoption projection", async () => {
      const deps = await ready();
      const store = deps.stores.forLearner(h.learner);
      const round = await store.round("r1");
      expect(
        (
          await store.commit({
            puts: [],
            updates: [
              {
                entry: {
                  type: "round",
                  value: makeRound({ deck: [CARD], firstPass: 1 }),
                },
                version: round?.version ?? 0,
              },
            ],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      await put(
        store,
        Array.from({ length: 40 }, (_, index): Entry => ({
          type: "review",
          value: makeReview({
            id: `legacy-${String(index).padStart(2, "0")}`,
            item: { kind: "composition", id: CARD },
          }),
        })),
      );
      const raced = { ...deps, stores: race(deps.stores) };
      expect(
        await Promise.all([
          recordAnswers(raced, h.context(), {
            roundId: "r1",
            answers: [first("tab-a")],
          }),
          recordAnswers(raced, h.context(), {
            roundId: "r1",
            answers: [first("tab-b")],
          }),
        ]),
      ).toStrictEqual([
        { ok: true, value: undefined },
        { ok: true, value: undefined },
      ]);
      expect((await store.round("r1"))?.value.answerState).toStrictEqual({
        firstCards: [CARD],
        cursor: null,
        complete: true,
      });
      expect(await store.reviewsOf("r1")).toHaveLength(40);
    });
  });
}
