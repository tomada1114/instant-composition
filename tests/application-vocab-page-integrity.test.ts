import { describe, expect, it } from "vitest";
import {
  advanceReadModelMaintenance,
  DEFAULT_PROFILE,
  finishVocabSession,
  getPagedVocabPage,
  preparePagedVocabSession,
  recordPagedVocabAnswers,
  recordVocabAnswers,
  startPagedVocabSession,
  startVocabSession,
  type Commit,
} from "@instant-composition/application";
import { createMemoryStores } from "@instant-composition/adapters";
import { DAY_MS } from "./application-harness";
import { pagedFixture, readyPaged } from "./vocab-pages-harness";

const answer = (cardId: string, page = 0) => ({
  id: `answer:${cardId}`,
  cardId,
  page,
  pass: "first" as const,
  grade: "good" as const,
  elapsedMs: 1,
});

describe("paged session cross-row integrity", () => {
  it("refuses the entire 20-input batch before its first write when one fresh page is unpublished", async () => {
    const h = await pagedFixture(20);
    await readyPaged(h);
    const store = h.stores.forLearner(h.learner);
    const deck = await store.vocabDeckPage("paged", 1, 0);
    if (deck === undefined) throw new Error("No published page.");
    expect(
      (
        await store.commit({
          puts: [
            {
              type: "vocabDeckPage",
              value: {
                sessionId: "paged",
                generation: 1,
                page: 1,
                cards: [{ id: "stray", isNew: false }],
              },
            },
          ],
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    expect(
      await getPagedVocabPage(h.deps, h.context(), {
        sessionId: "paged",
        cursor: "1:1",
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    expect(
      await getPagedVocabPage(h.deps, h.context(), {
        sessionId: "paged",
        cursor: null,
        retained: [{ page: 1, cardId: "stray" }],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    const inputs = [
      ...deck.value.cards.slice(0, 19).map((card) => answer(card.id)),
      answer("stray", 1),
    ];
    expect(
      await recordPagedVocabAnswers(h.deps, h.context(), {
        sessionId: "paged",
        generation: 1,
        answers: inputs,
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    expect(
      await store.vocabReviewsByIds(
        "paged",
        inputs.map((entry) => entry.id),
      ),
    ).toHaveLength(0);
    expect((await store.vocabPagedSession("paged"))?.value.answered).toBe(0);
  });

  it("refuses a valid-shaped progress row with foreign adoption before serving or writing", async () => {
    const h = await pagedFixture(2);
    await readyPaged(h);
    const store = h.stores.forLearner(h.learner);
    expect(
      (
        await store.commit({
          puts: [
            {
              type: "vocabPageProgress",
              value: {
                sessionId: "paged",
                generation: 1,
                page: 0,
                answered: ["foreign-card"],
              },
            },
          ],
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    expect(
      await getPagedVocabPage(h.deps, h.context(), {
        sessionId: "paged",
        cursor: null,
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
    const input = answer("v_due_0000");
    expect(
      await recordPagedVocabAnswers(h.deps, h.context(), {
        sessionId: "paged",
        generation: 1,
        answers: [input],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
    expect((await store.vocabReviewsByIds("paged", [input.id])).size).toBe(0);
    expect((await store.vocabPagedSession("paged"))?.value.answered).toBe(0);
  });

  it("preserves a mismatching closed legacy guard and refuses both answer and finish", async () => {
    const h = await pagedFixture(2);
    const result = await startVocabSession(h.deps, h.context(), {
      sessionId: "legacy",
      kind: "today",
    });
    if (!result.ok) throw new Error(result.error.code);
    const store = h.stores.forLearner(h.learner);
    expect(
      (
        await store.commit({
          puts: [
            {
              type: "vocabSessionGuard",
              value: {
                id: "legacy",
                finishedAt: 1000,
              },
            },
          ],
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    const input = answer(result.value.cards[0]?.id ?? "missing");
    const command = { sessionId: "legacy", answers: [input] };
    expect(await recordVocabAnswers(h.deps, h.context(), command)).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
    expect(await finishVocabSession(h.deps, h.context(), command)).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
    expect((await store.vocabSessionGuard("legacy"))?.value.finishedAt).toBe(1000);
    expect((await store.vocabSession("legacy"))?.value.finishedAt).toBeNull();
    expect((await store.vocabReviewsByIds("legacy", [input.id])).size).toBe(0);
  });

  it("rejects a concurrent active-generation change at the atomic answer commit", async () => {
    const base = await pagedFixture(2);
    await readyPaged(base);
    const store = base.stores.forLearner(base.learner);
    let raced = false;
    const deps = {
      ...base.deps,
      stores: {
        forLearner: () => ({
          ...store,
          commit: async (commit: Commit) => {
            if (!raced && commit.puts.some((entry) => entry.type === "vocabReview")) {
              raced = true;
              const header = await store.vocabPagedSession("paged");
              if (header === undefined) throw new Error("No race fixture header.");
              expect(
                commit.expect.some(({ key }) => key.type === "vocabDeckPage"),
              ).toBe(true);
              expect(
                (
                  await store.commit({
                    puts: [],
                    updates: [
                      {
                        entry: {
                          type: "vocabPagedSession",
                          value: { ...header.value, generation: 2 },
                        },
                        version: header.version,
                      },
                    ],
                    expect: [],
                  })
                ).ok,
              ).toBe(true);
            }
            return store.commit(commit);
          },
        }),
      },
    };
    const input = answer("v_due_0000");
    expect(
      await recordPagedVocabAnswers(deps, base.context(), {
        sessionId: "paged",
        generation: 1,
        answers: [input],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    expect(raced).toBe(true);
    expect((await store.vocabReviewsByIds("paged", [input.id])).size).toBe(0);
    expect((await store.vocabPagedSession("paged"))?.value.answered).toBe(0);
  });

  it("queues an expired old building day and resumes only after the independent bounded worker", async () => {
    const stores = createMemoryStores();
    const h = await pagedFixture(65, stores);
    expect(
      (
        await startPagedVocabSession(h.deps, h.context(), {
          sessionId: "late",
          kind: "today",
        })
      ).ok,
    ).toBe(true);
    expect((await preparePagedVocabSession(h.deps, h.context(), "late")).ok).toBe(true);
    const late = { ...h.context(), now: h.context().now + 7 * DAY_MS };
    const store = h.stores.forLearner(h.learner);
    expect(await preparePagedVocabSession(h.deps, late, "late")).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    expect((await store.vocabReadModelRequest("2026-09-22"))?.value.day).toBe(
      "2026-09-22",
    );
    expect(
      (
        await store.commit({
          puts: [{ type: "profile", value: DEFAULT_PROFILE }],
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    for (let step = 0; step < 200; step += 1) {
      const result = await advanceReadModelMaintenance(
        h.deps,
        stores.maintenance(),
        late.now,
      );
      if (!result.ok) throw new Error(result.error.code);
      expect(result.value.rows).toBeLessThanOrEqual(20);
      if ((await store.vocabReadModelRequest("2026-09-22")) === undefined) break;
    }
    expect(await store.vocabReadModelRequest("2026-09-22")).toBeUndefined();
    const restarted = await preparePagedVocabSession(h.deps, late, "late");
    expect(restarted.ok && restarted.value).toMatchObject({
      status: "building",
      generation: 2,
    });
    expect((await store.vocabDeckPage("late", 1, 0))?.value.cards).toHaveLength(64);
    expect((await preparePagedVocabSession(h.deps, late, "late")).ok).toBe(true);
    expect((await preparePagedVocabSession(h.deps, late, "late")).ok).toBe(true);
    expect((await store.vocabPagedSession("late"))?.value).toMatchObject({
      status: "ready",
      day: "2026-09-22",
      generation: 2,
    });
  });
});
