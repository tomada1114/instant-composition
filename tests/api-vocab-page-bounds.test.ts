import { describe, expect, it } from "vitest";
import { createMemoryStores } from "@instant-composition/adapters";
import {
  vocabPageSchema,
  vocabPagedSummarySchema,
  vocabPreparationSchema,
} from "@instant-composition/contracts";
import { makeApi } from "./api-harness";
import { pagedFixture } from "./vocab-pages-harness";
import { makeVocabProgress, makeVocabReview } from "./application-fixtures";
import { prepareVocabReadModels } from "./read-model-harness";

describe("complete bounded paged HTTP journey", () => {
  it("keeps the same reads and result with zero or 1200 unrelated progress/history rows", async () => {
    const outcomes = [];
    for (const noise of [0, 1200]) {
      const stores = createMemoryStores();
      const h = await pagedFixture(2, stores);
      const store = stores.forLearner(h.learner);
      for (let from = 0; from < noise; from += 40) {
        const ids = Array.from(
          { length: Math.min(40, noise - from) },
          (_, i) => `noise-${String(from + i)}`,
        );
        expect(
          (
            await store.commit({
              puts: ids.flatMap((cardId) => [
                { type: "vocabItem" as const, value: makeVocabProgress({ cardId }) },
                {
                  type: "vocabReview" as const,
                  value: makeVocabReview({ sessionId: "archive", id: cardId, cardId }),
                },
              ]),
              updates: [],
              expect: [],
            })
          ).ok,
        ).toBe(true);
      }
      const api = makeApi({
        stores,
        catalog: h.deps.catalog,
        newLearnerId: () => h.learner,
      });
      expect((await api.call("GET", "/v1/settings")).status).toBe(200);
      await prepareVocabReadModels(h.deps, h.context());
      const before = stores.readCount();
      const started = await api.call("POST", "/v1/vocab/paged-sessions", {
        sessionId: "bounded",
        kind: "today",
      });
      expect(started.status).toBe(200);
      expect(vocabPreparationSchema.parse(await started.json()).status).toBe(
        "building",
      );
      const prepared = await api.call(
        "POST",
        "/v1/vocab/paged-sessions/bounded/prepare",
      );
      expect(prepared.status).toBe(200);
      expect(vocabPreparationSchema.parse(await prepared.json())).toMatchObject({
        status: "ready",
        total: 2,
      });
      const read = await api.call("POST", "/v1/vocab/paged-sessions/bounded/page", {
        cursor: null,
      });
      expect(read.status).toBe(200);
      const page = vocabPageSchema.parse(await read.json());
      const answers = page.cards.map((card) => ({
        id: `first:${card.id}`,
        cardId: card.id,
        page: 0,
        pass: "first",
        grade: "good",
        elapsedMs: 10,
      }));
      expect(
        (
          await api.call("POST", "/v1/vocab/paged-sessions/bounded/answers", {
            generation: 1,
            answers,
          })
        ).status,
      ).toBe(204);
      const reloaded = await api.call("POST", "/v1/vocab/paged-sessions/bounded/page", {
        cursor: null,
      });
      expect(reloaded.status).toBe(200);
      expect(vocabPageSchema.parse(await reloaded.json()).answered).toHaveLength(2);
      const finished = await api.call(
        "POST",
        "/v1/vocab/paged-sessions/bounded/finish",
        { generation: 1, answers: [] },
      );
      expect(finished.status).toBe(200);
      const summary = vocabPagedSummarySchema.parse(await finished.json());
      outcomes.push({
        reads: stores.readCount() - before,
        cards: page.cards.map((card) => card.id),
        summary,
      });
    }
    expect(outcomes[1]).toStrictEqual(outcomes[0]);
    expect(outcomes[0]?.cards).toStrictEqual(["v_due_0000", "v_due_0001"]);
    expect(outcomes[0]?.summary).toMatchObject({
      answered: 2,
      againCount: 0,
      again: [],
    });
  });
});
