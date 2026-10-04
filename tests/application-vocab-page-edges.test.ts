import { describe, expect, it } from "vitest";
import {
  getPagedVocabPage,
  recordPagedVocabAnswers,
  startPagedVocabSession,
  preparePagedVocabSession,
  startVocabSession,
  recordVocabAnswers,
  deleteVocabCard,
  updateSettings,
  type VocabPageView,
  type Commit,
  type VocabItem,
} from "@instant-composition/application";
import { pagedFixture, readyPaged, type PagedHarness } from "./vocab-pages-harness";
import { fixedCatalog, makeSnapshot, vocabItem, DAY_MS } from "./application-harness";
import { makePersonalCard, makeVocabProgress } from "./application-fixtures";
import { prepareVocabReadModels } from "./read-model-harness";

async function pages(h: PagedHarness, id: string): Promise<VocabPageView[]> {
  const result: VocabPageView[] = [];
  let cursor: string | null = null;
  do {
    const page = await getPagedVocabPage(h.deps, h.context(), {
      sessionId: id,
      cursor,
    });
    if (!page.ok) throw new Error(page.error.code);
    result.push(page.value);
    cursor = page.value.continuation;
  } while (cursor !== null);
  return result;
}
async function category(h: PagedHarness, id: string, selected: "word" | "idiom") {
  let result = await startPagedVocabSession(h.deps, h.context(), {
    sessionId: id,
    kind: "today",
    category: selected,
  });
  if (!result.ok) throw new Error(result.error.code);
  while (result.value.status === "building") {
    result = await preparePagedVocabSession(h.deps, h.context(), id);
    if (!result.ok) throw new Error(result.error.code);
  }
  return (await pages(h, id)).flatMap((page) =>
    page.cards.map((card) => ({ ...card, page: page.page })),
  );
}
describe("paged vocabulary boundaries", () => {
  it("filters categories after the global fresh allocation and keeps their daily new quota shared", async () => {
    const base = await pagedFixture(129);
    const original = await base.deps.catalog.snapshot();
    if (!original.ok) throw new Error(original.error.code);
    const vocab = [
      ...original.value.vocab.values(),
      ...Array.from({ length: 8 }, (_, index) => ({
        ...vocabItem(index % 2 === 0 ? "word" : "idiom", 1, index),
        id: `v_new_${String(index)}`,
      })),
    ];
    const h = {
      ...base,
      deps: {
        ...base.deps,
        catalog: fixedCatalog({ ...makeSnapshot({ vocab }), version: "fresh-fixture" }),
      },
    };
    expect((await updateSettings(h.deps, h.context(), { vocabNewPerDay: 5 })).ok).toBe(
      true,
    );
    await prepareVocabReadModels(h.deps, h.context());
    await readyPaged(h, "global");
    const global = (await pages(h, "global")).flatMap((page) => page.cards);
    const words = await category(h, "words", "word");
    const idioms = await category(h, "idioms", "idiom");
    expect(words.map((card) => card.id)).toStrictEqual(
      global.filter((card) => card.category === "word").map((card) => card.id),
    );
    expect(idioms.map((card) => card.id)).toStrictEqual(
      global.filter((card) => card.category === "idiom").map((card) => card.id),
    );
    expect([...words, ...idioms].filter((card) => card.isNew)).toHaveLength(5);
    const introduced = words.filter((card) => card.isNew);
    expect(
      (
        await recordPagedVocabAnswers(h.deps, h.context(), {
          sessionId: "words",
          generation: 1,
          answers: introduced.map((card) => ({
            id: `f:${card.id}`,
            cardId: card.id,
            page: card.page,
            pass: "first",
            grade: "good",
            elapsedMs: 10,
          })),
        })
      ).ok,
    ).toBe(true);
    const after = await category(h, "after-word-introduction", "idiom");
    await readyPaged(h, "global-after-introduction");
    const remaining = (await pages(h, "global-after-introduction"))
      .flatMap((page) => page.cards)
      .filter((card) => card.isNew);
    expect(remaining).toHaveLength(5 - introduced.length);
    expect(after.filter((card) => card.isNew).map((card) => card.id)).toStrictEqual(
      remaining.filter((card) => card.category === "idiom").map((card) => card.id),
    );
  });
  it("reads and answers by bounded keys without iterating the whole catalog or learner history", async () => {
    const base = await pagedFixture(65);
    await readyPaged(base);
    const original = await base.deps.catalog.snapshot();
    if (!original.ok) throw new Error(original.error.code);
    class PointOnly extends Map<string, VocabItem> {
      override values(): MapIterator<VocabItem> {
        throw new Error("Whole catalog copied.");
      }
    }
    const h = {
      ...base,
      deps: {
        ...base.deps,
        catalog: fixedCatalog({
          ...original.value,
          vocab: new PointOnly(original.value.vocab),
        }),
        stores: {
          forLearner(id: Parameters<typeof base.stores.forLearner>[0]) {
            const store = base.stores.forLearner(id);
            const forbidden = () =>
              Promise.reject(new Error("Whole learner history read."));
            return {
              ...store,
              vocabItems: forbidden,
              vocabReviewsOf: forbidden,
              cards: forbidden,
            };
          },
        },
      },
    };
    const first = (await pages(h, "paged"))[0]?.cards[0];
    if (first === undefined) throw new Error("No first card.");
    expect(
      (
        await recordPagedVocabAnswers(h.deps, h.context(), {
          sessionId: "paged",
          generation: 1,
          answers: [
            {
              id: "first",
              cardId: first.id,
              page: 0,
              pass: "first",
              grade: "good",
              elapsedMs: 10,
            },
          ],
        })
      ).ok,
    ).toBe(true);
  });
  it("keeps frozen membership and day while withdrawing current and retained cards after a catalog replacement", async () => {
    const base = await pagedFixture(65);
    await readyPaged(base);
    const original = await base.deps.catalog.snapshot();
    if (!original.ok) throw new Error(original.error.code);
    const vocab = [...original.value.vocab.values()].filter(
      (card) => card.id !== "v_due_0000",
    );
    vocab.push({ ...vocabItem("word", 1, 999), id: "v_added_after_ready" });
    const h = {
      ...base,
      deps: {
        ...base.deps,
        catalog: fixedCatalog({ ...makeSnapshot({ vocab }), version: "replacement" }),
      },
    };
    const view = await getPagedVocabPage(
      h.deps,
      {
        ...h.context(),
        now: h.context().now + DAY_MS,
        learner: { ...h.context().learner, timeZone: "America/Los_Angeles" },
      },
      {
        sessionId: "paged",
        cursor: "1:1",
        retained: [
          { page: 0, cardId: "v_due_0000" },
          { page: 0, cardId: "v_due_0001" },
        ],
      },
    );
    expect(view.ok && view.value.day).toBe("2026-09-22");
    expect(
      view.ok && view.value.retained.map((card) => [card.id, card.slot]),
    ).toStrictEqual([["v_due_0001", 1]]);
    const first = (await pages(h, "paged"))[0];
    expect(first?.cards[0]).toMatchObject({ id: "v_due_0001", slot: 1 });
    expect(
      (await pages(h, "paged"))
        .flatMap((page) => page.cards)
        .some((card) => card.id === "v_added_after_ready"),
    ).toBe(false);
    expect(
      await getPagedVocabPage(h.deps, h.context(), {
        sessionId: "paged",
        cursor: "1:1",
        retained: [{ page: 0, cardId: "v_added_after_ready" }],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
  });
  it("omits deleted personal cards from both current and retained views and retains their adopted log", async () => {
    const h = await pagedFixture(65);
    const store = h.stores.forLearner(h.learner);
    const personal = makePersonalCard();
    expect(
      (
        await store.commit({
          puts: [
            { type: "card", value: personal },
            {
              type: "vocabItem",
              value: makeVocabProgress({
                cardId: personal.id,
                source: { kind: "talk", talkId: "t1", turn: 1 },
                state: {
                  dueDay: "2026-09-22",
                  lastDay: "2026-09-21",
                  stability: 2,
                  difficulty: 5,
                  lapses: 0,
                  reps: 1,
                },
              }),
            },
          ],
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    expect((await updateSettings(h.deps, h.context(), { vocabNewPerDay: 5 })).ok).toBe(
      true,
    );
    await prepareVocabReadModels(h.deps, h.context());
    await readyPaged(h);
    const selected = (await pages(h, "paged")).find((page) =>
      page.cards.some((card) => card.id === personal.id),
    );
    if (selected === undefined) throw new Error("No personal card dealt.");
    const answer = {
      id: "personal-first",
      cardId: personal.id,
      page: selected.page,
      pass: "first" as const,
      grade: "again" as const,
      elapsedMs: 10,
    };
    expect(
      (
        await recordPagedVocabAnswers(h.deps, h.context(), {
          sessionId: "paged",
          generation: 1,
          answers: [answer],
        })
      ).ok,
    ).toBe(true);
    expect(
      (await deleteVocabCard(h.deps, h.context(), { cardId: personal.id })).ok,
    ).toBe(true);
    const view = await getPagedVocabPage(h.deps, h.context(), {
      sessionId: "paged",
      cursor: `1:${String(selected.page)}`,
      retained: [{ page: selected.page, cardId: personal.id }],
    });
    expect(view.ok && view.value.cards.some((card) => card.id === personal.id)).toBe(
      false,
    );
    expect(view.ok && view.value.retained).toStrictEqual([]);
    expect((await store.vocabReviewsByIds("paged", [answer.id])).size).toBe(1);
  });
  it("writes only the small legacy guard on answers while preserving whole finite starts and replay", async () => {
    const base = await pagedFixture(2);
    const commits: Commit[] = [];
    const h = {
      ...base,
      deps: {
        ...base.deps,
        stores: {
          forLearner(id: Parameters<typeof base.stores.forLearner>[0]) {
            const store = base.stores.forLearner(id);
            return {
              ...store,
              commit: async (commit: Commit) => {
                commits.push(commit);
                return store.commit(commit);
              },
            };
          },
        },
      },
    };
    const start = await startVocabSession(h.deps, h.context(), {
      sessionId: "legacy",
      kind: "today",
    });
    if (!start.ok) throw new Error(start.error.code);
    expect(start.value.cards).toHaveLength(2);
    const command = {
      sessionId: "legacy",
      answers: start.value.cards.map((card) => ({
        id: card.id,
        cardId: card.id,
        pass: "first" as const,
        grade: "good" as const,
        elapsedMs: 10,
      })),
    };
    commits.length = 0;
    expect((await recordVocabAnswers(h.deps, h.context(), command)).ok).toBe(true);
    expect((await recordVocabAnswers(h.deps, h.context(), command)).ok).toBe(true);
    expect(commits.length).toBeGreaterThan(0);
    for (const commit of commits) {
      expect(
        [...commit.puts, ...commit.updates.map((entry) => entry.entry)].some(
          (entry) => entry.type === "vocabSession",
        ),
      ).toBe(false);
      expect(
        commit.expect.some((condition) => condition.key.type === "vocabSession"),
      ).toBe(true);
    }
    expect(
      (await base.stores.forLearner(base.learner).vocabSessionGuard("legacy"))?.value
        .finishedAt,
    ).toBeNull();
  });
});
