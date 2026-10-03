import { describe, expect, it } from "vitest";

import {
  deleteVocabCard,
  finishVocabSession,
  learnerId,
  recordVocabAnswers,
  type ApplicationDeps,
  type Commit,
  type LearnerStores,
} from "@instant-composition/application";
import type { VocabAnswer } from "@instant-composition/domain";

import {
  makePersonalCard,
  makeVocabProgress,
  makeVocabReview,
  makeVocabSession,
} from "./application-fixtures";
import {
  fixedCatalog,
  makeHarness,
  makeSnapshot,
  vocabItem,
} from "./application-harness";

const CARD = makePersonalCard();
const OTHER = vocabItem("word", 4, 1);
const B = learnerId("learner-b");

function answer(cardId: string): VocabAnswer {
  return {
    id: `answer:${cardId}`,
    cardId,
    pass: "first",
    grade: "good",
    elapsedMs: 1000,
  };
}

async function ready(
  createStores: () => LearnerStores | Promise<LearnerStores>,
  progress: boolean,
) {
  const h = makeHarness();
  const stores = await createStores();
  const store = stores.forLearner(h.learner);
  const personalProgress = makeVocabProgress({
    cardId: CARD.id,
    source: CARD.source,
    state: null,
    firstDay: null,
  });
  const written = await store.commit({
    puts: [
      { type: "card", value: CARD },
      { type: "vocabSession", value: makeVocabSession({ deck: [CARD.id, OTHER.id] }) },
      {
        type: "vocabReview",
        value: makeVocabReview({ id: "history", sessionId: "old", cardId: CARD.id }),
      },
      ...(progress ? [{ type: "vocabItem" as const, value: personalProgress }] : []),
    ],
    updates: [],
    expect: [],
  });
  expect(written.ok).toBe(true);
  expect(
    (
      await stores.forLearner(B).commit({
        puts: [
          { type: "card", value: CARD },
          { type: "vocabItem", value: personalProgress },
        ],
        updates: [],
        expect: [],
      })
    ).ok,
  ).toBe(true);
  const deps: ApplicationDeps = {
    stores,
    catalog: fixedCatalog(makeSnapshot({ vocab: [OTHER] })),
  };
  return {
    deps,
    store,
    context: h.context(),
    otherBefore: await stores.forLearner(B).vocabItems(),
  };
}

/** Let the other command commit after this command has loaded its plan, once. */
function interleaved(
  deps: ApplicationDeps,
  matches: (commit: Commit) => boolean,
  before: () => Promise<void>,
): ApplicationDeps {
  let waiting = true;
  return {
    ...deps,
    stores: {
      forLearner(id) {
        const store = deps.stores.forLearner(id);
        return {
          ...store,
          async commit(commit) {
            if (waiting && matches(commit)) {
              waiting = false;
              await before();
            }
            return store.commit(commit);
          },
        };
      },
    },
  };
}

/** Both adapters must keep deletion final under either command's winning commit. */
export function describeVocabCardDeletionContract(
  name: string,
  createStores: () => LearnerStores | Promise<LearnerStores>,
): void {
  describe(`${name}: concurrent card deletion`, () => {
    it.each([
      ["record", recordVocabAnswers],
      ["finish", finishVocabSession],
    ] as const)(
      "%s reloads a deleted personal card before retrying its answer",
      async (_, record) => {
        const h = await ready(createStores, true);
        let deleted = false;
        const raced = interleaved(
          h.deps,
          (commit) => commit.puts.some((entry) => entry.type === "vocabReview"),
          async () => {
            expect(
              (await deleteVocabCard(h.deps, h.context, { cardId: CARD.id })).ok,
            ).toBe(true);
            deleted = true;
          },
        );

        expect(
          (
            await record(raced, h.context, {
              sessionId: "s1",
              answers: [answer(CARD.id), answer(OTHER.id)],
            })
          ).ok,
        ).toBe(true);

        expect(deleted).toBe(true);
        expect(await h.store.card(CARD.id)).toBeUndefined();
        expect((await h.store.vocabItems()).has(CARD.id)).toBe(false);
        expect((await h.store.vocabItems()).get(OTHER.id)?.value.state?.reps).toBe(1);
        expect(
          (await h.store.vocabReviewsOf("s1")).map((review) => review.cardId),
        ).toStrictEqual([OTHER.id]);
        expect(
          (await h.store.vocabReviewsOf("old")).map((review) => review.id),
        ).toStrictEqual(["history"]);
        expect(await h.deps.stores.forLearner(B).vocabItems()).toStrictEqual(
          h.otherBefore,
        );
        expect((await h.deps.stores.forLearner(B).card(CARD.id))?.value).toStrictEqual(
          CARD,
        );
      },
    );

    it.each([
      ["record", recordVocabAnswers],
      ["finish", finishVocabSession],
    ] as const)(
      "deletion removes progress created by a racing %s after its absent read",
      async (_, record) => {
        const h = await ready(createStores, false);
        let answered = false;
        const raced = interleaved(
          h.deps,
          (commit) =>
            commit.deletes?.some((entry) => entry.key.type === "card") === true,
          async () => {
            expect(
              (
                await record(h.deps, h.context, {
                  sessionId: "s1",
                  answers: [answer(CARD.id), answer(OTHER.id)],
                })
              ).ok,
            ).toBe(true);
            answered = true;
          },
        );

        expect(
          await deleteVocabCard(raced, h.context, { cardId: CARD.id }),
        ).toStrictEqual({ ok: true, value: undefined });

        expect(answered).toBe(true);
        expect(await h.store.card(CARD.id)).toBeUndefined();
        expect((await h.store.vocabItems()).has(CARD.id)).toBe(false);
        expect((await h.store.vocabItems()).get(OTHER.id)?.value.state?.reps).toBe(1);
        expect(
          (await h.store.vocabReviewsOf("s1")).map((review) => review.cardId).sort(),
        ).toStrictEqual([CARD.id, OTHER.id]);
        expect(
          (await h.store.vocabReviewsOf("old")).map((review) => review.id),
        ).toStrictEqual(["history"]);
        expect(await h.deps.stores.forLearner(B).vocabItems()).toStrictEqual(
          h.otherBefore,
        );
      },
    );

    it("reloads a personal card's changed snapshot after losing its version check", async () => {
      const h = await ready(createStores, true);
      const raced = interleaved(
        h.deps,
        (commit) => commit.puts.some((entry) => entry.type === "vocabReview"),
        async () => {
          expect(
            (
              await h.store.commit({
                puts: [],
                updates: [
                  {
                    entry: {
                      type: "card",
                      value: { ...CARD, meaning: "変更後の意味" },
                    },
                    version: 1,
                  },
                ],
                expect: [],
              })
            ).ok,
          ).toBe(true);
        },
      );

      expect(
        (
          await recordVocabAnswers(raced, h.context, {
            sessionId: "s1",
            answers: [answer(CARD.id)],
          })
        ).ok,
      ).toBe(true);

      expect((await h.store.vocabReviewsOf("s1"))[0]?.snapshot.meaning).toBe(
        "変更後の意味",
      );
    });

    it("records a full batch of distinct personal cards within the transaction limit", async () => {
      const h = makeHarness();
      const stores = await createStores();
      const store = stores.forLearner(h.learner);
      const cards = Array.from({ length: 100 }, (_, index) =>
        makePersonalCard({ id: `p_${String(index).padStart(12, "0")}` }),
      );
      for (const card of cards) {
        expect(
          (
            await store.commit({
              puts: [
                { type: "card", value: card },
                {
                  type: "vocabItem",
                  value: makeVocabProgress({
                    cardId: card.id,
                    source: card.source,
                    state: null,
                    firstDay: null,
                  }),
                },
              ],
              updates: [],
              expect: [],
            })
          ).ok,
        ).toBe(true);
      }
      expect(
        (
          await store.commit({
            puts: [
              {
                type: "vocabSession",
                value: makeVocabSession({ deck: cards.map((card) => card.id) }),
              },
            ],
            updates: [],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      const deps = { stores, catalog: fixedCatalog(makeSnapshot({ vocab: [] })) };

      expect(
        (
          await recordVocabAnswers(deps, h.context(), {
            sessionId: "s1",
            answers: cards.map((card) => answer(card.id)),
          })
        ).ok,
      ).toBe(true);

      expect(await store.vocabReviewsOf("s1")).toHaveLength(100);
      expect((await store.vocabItems()).size).toBe(100);
    });
  });
}
