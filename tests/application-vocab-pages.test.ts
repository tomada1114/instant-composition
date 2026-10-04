import { describe, expect, it } from "vitest";
import {
  startPagedVocabSession,
  preparePagedVocabSession,
  getPagedVocabPage,
  recordPagedVocabAnswers,
  finishPagedVocabSession,
  updateSettings,
  type Commit,
  type VocabPageView,
} from "@instant-composition/application";
import { VOCAB_PAGE_SIZE, type VocabPagedAnswer } from "@instant-composition/domain";
import { pagedFixture, readyPaged } from "./vocab-pages-harness";

function firstAnswers(page: VocabPageView): VocabPagedAnswer[] {
  return page.cards.map((card) => ({
    id: `f:${card.id}`,
    cardId: card.id,
    page: page.page,
    pass: "first",
    grade: "good",
    elapsedMs: 100,
  }));
}

describe("continuous paged vocabulary sessions", () => {
  it("consumes 193 unique due cards through immutable pages and bounded answer commits", async () => {
    const original = await pagedFixture();
    const commits: Commit[] = [];
    const h = {
      ...original,
      deps: {
        ...original.deps,
        stores: {
          forLearner(id: Parameters<typeof original.stores.forLearner>[0]) {
            const store = original.stores.forLearner(id);
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
    const prep = await readyPaged(h);
    expect(prep.total).toBe(193);
    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await getPagedVocabPage(h.deps, h.context(), {
        sessionId: "paged",
        cursor,
      });
      if (!result.ok) throw new Error(result.error.code);
      const page = result.value;
      expect(page.cards.length).toBeLessThanOrEqual(VOCAB_PAGE_SIZE);
      all.push(...page.cards.map((card) => card.id));
      const answers = firstAnswers(page);
      for (let index = 0; index < answers.length; index += 60)
        expect(
          (
            await recordPagedVocabAnswers(h.deps, h.context(), {
              sessionId: "paged",
              generation: prep.generation,
              answers: answers.slice(index, index + 60),
            })
          ).ok,
        ).toBe(true);
      const replayed = await getPagedVocabPage(h.deps, h.context(), {
        sessionId: "paged",
        cursor,
      });
      expect(replayed.ok && replayed.value.cards.map((card) => card.id)).toStrictEqual(
        page.cards.map((card) => card.id),
      );
      cursor = page.continuation;
    } while (cursor !== null);
    expect(all).toHaveLength(193);
    expect(new Set(all).size).toBe(193);
    const answerCommits = commits.filter((commit) =>
      commit.puts.some((entry) => entry.type === "vocabReview"),
    );
    expect(answerCommits.length).toBeGreaterThan(1);
    for (const commit of answerCommits) {
      expect(
        commit.puts.length +
          commit.updates.length +
          commit.expect.length +
          (commit.deletes?.length ?? 0) +
          1,
      ).toBeLessThanOrEqual(100);
      expect(JSON.stringify(commit).length * 3).toBeLessThan(4 * 1024 * 1024);
      for (const entry of [
        ...commit.puts,
        ...commit.updates.map((update) => update.entry),
      ]) {
        expect(entry.type).not.toBe("vocabDeckPage");
        expect(JSON.stringify(entry).length * 3 + 1024).toBeLessThan(400 * 1024);
      }
    }
    const summary = await finishPagedVocabSession(h.deps, h.context(), {
      sessionId: "paged",
      generation: prep.generation,
      answers: [],
    });
    expect(summary.ok && summary.value.answered).toBe(193);
    expect(
      (await original.stores.forLearner(h.learner).vocabPagedSession("paged"))?.value
        .fresh,
    ).toStrictEqual([]);
  });

  it("restarts preparation on a foreign source change and resumes its original logical id", async () => {
    const h = await pagedFixture();
    const start = await startPagedVocabSession(h.deps, h.context(), {
      sessionId: "restart",
      kind: "today",
    });
    expect(start.ok && start.value.status).toBe("building");
    const first = await preparePagedVocabSession(h.deps, h.context(), "restart");
    expect(first.ok && first.value.generation).toBe(1);
    expect(
      (await updateSettings(h.deps, h.context(), { vocabReviewsPerDay: 50 })).ok,
    ).toBe(true);
    const restarted = await preparePagedVocabSession(h.deps, h.context(), "restart");
    expect(restarted.ok && restarted.value).toMatchObject({
      sessionId: "restart",
      generation: 2,
      total: 50,
    });
    expect(
      await startPagedVocabSession(h.deps, h.context(), {
        sessionId: "restart",
        kind: "weak",
      }),
    ).toStrictEqual(restarted);
    const denied = await getPagedVocabPage(h.deps, h.context(), {
      sessionId: "restart",
      cursor: "1:0",
    });
    expect(denied).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
  });

  it("replays saved ids after close and refuses fresh ids without losing the first checkpoint", async () => {
    const h = await pagedFixture(2);
    const prep = await readyPaged(h);
    const page = await getPagedVocabPage(h.deps, h.context(), {
      sessionId: "paged",
      cursor: null,
    });
    if (!page.ok) throw new Error(page.error.code);
    const answers = firstAnswers(page.value);
    expect(
      (
        await recordPagedVocabAnswers(h.deps, h.context(), {
          sessionId: "paged",
          generation: prep.generation,
          answers,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await finishPagedVocabSession(h.deps, h.context(), {
          sessionId: "paged",
          generation: prep.generation,
          answers,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await recordPagedVocabAnswers(h.deps, h.context(), {
          sessionId: "paged",
          generation: prep.generation,
          answers,
        })
      ).ok,
    ).toBe(true);
    const first = answers[0];
    if (first === undefined) throw new Error("The fixture has no first answer.");
    const refused = await recordPagedVocabAnswers(h.deps, h.context(), {
      sessionId: "paged",
      generation: prep.generation,
      answers: [{ ...first, id: "new-id" }],
    });
    expect(refused).toStrictEqual({ ok: false, error: { code: "ERR_SESSION_CLOSED" } });
    expect(
      (
        await h.stores
          .forLearner(h.learner)
          .vocabPageProgress("paged", prep.generation, 0)
      )?.value.answered,
    ).toHaveLength(2);
  });
});
