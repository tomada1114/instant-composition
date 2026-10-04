import { describe, expect, it } from "vitest";
import {
  vocabPageSchema,
  vocabPreparationSchema,
  vocabPagedSummarySchema,
  vocabSessionSchema,
  errorResponseSchema,
  vocabSummarySchema,
} from "@instant-composition/contracts";
import { pagedFixture } from "./vocab-pages-harness";
import { makeApi, subjectAuthenticator } from "./api-harness";
import { prepareVocabReadModels } from "./read-model-harness";
import { makeVocabSession } from "./application-fixtures";
import { NOON } from "./application-harness";

async function apiFixture(size = 257) {
  const h = await pagedFixture(size);
  const api = makeApi({
    stores: h.stores,
    catalog: h.deps.catalog,
    newLearnerId: () => h.learner,
  });
  expect((await api.call("GET", "/v1/settings")).status).toBe(200);
  await prepareVocabReadModels(h.deps, h.context());
  return { h, api };
}
async function ready(api: ReturnType<typeof makeApi>, id = "paged") {
  const start = await api.call("POST", "/v1/vocab/paged-sessions", {
    sessionId: id,
    kind: "today",
  });
  expect(start.status).toBe(200);
  let preparation = vocabPreparationSchema.parse(await start.json());
  for (let step = 0; preparation.status === "building" && step < 20; step += 1) {
    const next = await api.call("POST", `/v1/vocab/paged-sessions/${id}/prepare`);
    expect(next.status).toBe(200);
    preparation = vocabPreparationSchema.parse(await next.json());
  }
  expect(preparation.status).toBe("ready");
  return preparation;
}
describe("the additive vocabulary continuation API", () => {
  it("keeps old finite responses whole and explicitly refuses unlimited old-client truncation", async () => {
    const { api } = await apiFixture();
    const old = await api.call("POST", "/v1/vocab/sessions", {
      sessionId: "old",
      kind: "today",
    });
    expect(old.status).toBe(409);
    expect(errorResponseSchema.parse(await old.json()).error.code).toBe(
      "ERR_PAGED_SESSION_REQUIRED",
    );
    expect(
      (await api.call("PATCH", "/v1/settings", { vocabReviewsPerDay: 50 })).status,
    ).toBe(200);
    const extra = await api.call("POST", "/v1/vocab/sessions", {
      sessionId: "extra",
      kind: "extra",
    });
    expect(extra.status).toBe(200);
    const finite = vocabSessionSchema.parse(await extra.json());
    expect(finite.cards).toHaveLength(10);
    const again = await api.call("POST", "/v1/vocab/sessions", {
      sessionId: "extra",
      kind: "today",
    });
    expect(await again.json()).toStrictEqual(finite);
    const { api: small } = await apiFixture(65);
    const complete = await small.call("POST", "/v1/vocab/sessions", {
      sessionId: "small",
      kind: "today",
    });
    expect(complete.status).toBe(200);
    expect(vocabSessionSchema.parse(await complete.json()).cards).toHaveLength(65);
  });
  it("continues beyond a candidate page, retries a lost next-page response, and validates the entire maximum input before adopting any answer", async () => {
    const { api, h } = await apiFixture();
    const preparation = await ready(api);
    expect(preparation.total).toBe(257);
    const read = async (cursor: string | null) => {
      const response = await api.call("POST", "/v1/vocab/paged-sessions/paged/page", {
        cursor,
      });
      expect(response.status).toBe(200);
      return vocabPageSchema.parse(await response.json());
    };
    const first = await read(null);
    const lost = await read(first.continuation);
    const retried = await read(first.continuation);
    expect(retried).toStrictEqual(lost);
    const answers = first.cards.slice(0, 60).map((card, index) => ({
      id: `first-${String(index)}`,
      cardId: card.id,
      page: first.page,
      pass: "first",
      grade: "good",
      elapsedMs: 100,
    }));
    const path = "/v1/vocab/paged-sessions/paged/answers";
    const invalid = await api.call("POST", path, {
      generation: preparation.generation,
      answers: [...answers.slice(0, 59), { ...answers[59], cardId: "v_not_member" }],
    });
    expect(invalid.status).toBe(400);
    expect(await h.stores.forLearner(h.learner).vocabReviewsOf("paged")).toHaveLength(
      0,
    );
    const oversized = await api.call("POST", path, {
      generation: preparation.generation,
      answers: [...answers, answers[0]],
    });
    expect(oversized.status).toBe(400);
    expect(
      (await api.call("POST", path, { generation: preparation.generation, answers }))
        .status,
    ).toBe(204);
    expect(
      (await api.call("POST", path, { generation: preparation.generation, answers }))
        .status,
    ).toBe(204);
    expect(await h.stores.forLearner(h.learner).vocabReviewsOf("paged")).toHaveLength(
      60,
    );
    expect((await read(null)).answered).toHaveLength(60);
    const ids = [...first.cards.map((card) => card.id)];
    let page = first;
    while (page.continuation !== null) {
      page = await read(page.continuation);
      ids.push(...page.cards.map((card) => card.id));
    }
    expect(ids).toHaveLength(257);
    expect(new Set(ids).size).toBe(257);
    const finished = await api.call("POST", "/v1/vocab/paged-sessions/paged/finish", {
      generation: preparation.generation,
      answers: [],
    });
    expect(finished.status).toBe(200);
    expect(vocabPagedSummarySchema.parse(await finished.json()).answered).toBe(60);
    expect(
      (await api.call("POST", path, { generation: preparation.generation, answers }))
        .status,
    ).toBe(204);
    const other = makeApi({
      stores: h.stores,
      catalog: h.deps.catalog,
      authenticator: subjectAuthenticator("other"),
    });
    expect(
      (
        await other.call("POST", "/v1/vocab/paged-sessions/paged/page", {
          cursor: first.continuation,
        })
      ).status,
    ).toBe(404);
  });
});

describe("saved unlimited legacy vocabulary session recovery", () => {
  it("keeps a 257-card historical deck and original queued answer IDs through temporary finish unavailability, rebuild, close and replay", async () => {
    const { h, api } = await apiFixture(257);
    const store = h.stores.forLearner(h.learner);
    const snapshot = await h.deps.catalog.snapshot();
    if (!snapshot.ok) throw new Error(snapshot.error.code);
    const deck = [...snapshot.value.vocab.keys()];
    expect(deck).toHaveLength(257);
    const session = makeVocabSession({ id: "saved-large", deck, startedAt: NOON });
    expect(
      (
        await store.commit({
          puts: [{ type: "vocabSession", value: session }],
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    const oldStart = await api.call("POST", "/v1/vocab/sessions", {
      sessionId: session.id,
      kind: "today",
    });
    expect(oldStart.status).toBe(409);
    expect(errorResponseSchema.parse(await oldStart.json()).error.code).toBe(
      "ERR_PAGED_SESSION_REQUIRED",
    );
    expect((await store.vocabSession(session.id))?.value).toStrictEqual(session);
    const answers = deck.map((cardId, index) => ({
      id: `saved-original-${String(index)}`,
      cardId,
      pass: "first" as const,
      grade: index === 0 ? ("again" as const) : ("good" as const),
      elapsedMs: 1200,
      answeredAt: NOON,
    }));
    const answerPath = `/v1/vocab/sessions/${session.id}/answers`;
    const finishPath = `/v1/vocab/sessions/${session.id}/finish`;
    for (let offset = 0; offset < 240; offset += 20) {
      const sent = await api.call("POST", answerPath, {
        answers: answers.slice(offset, offset + 20),
      });
      expect(sent.status).toBe(204);
      expect(await sent.text()).toBe("");
    }
    // Losing a derived cache is temporary; the old saved session and queue remain authoritative.
    const model = await store.vocabReadModel(session.day);
    if (model === undefined)
      throw new Error("The prepared fixture needs its read model.");
    expect(
      (
        await store.commit({
          puts: [],
          updates: [],
          expect: [],
          deletes: [
            {
              key: { type: "vocabReadModel", day: session.day },
              version: model.version,
            },
          ],
        })
      ).ok,
    ).toBe(true);
    const pending = { answers: answers.slice(240) };
    for (let retry = 0; retry < 2; retry += 1) {
      const waiting = await api.call("POST", finishPath, pending);
      expect(waiting.status).toBe(503);
      expect(waiting.headers.get("Retry-After")).toBe("2");
      expect(errorResponseSchema.parse(await waiting.json()).error.code).toBe(
        "ERR_READ_MODEL_NOT_READY",
      );
      expect((await store.vocabSession(session.id))?.value).toStrictEqual(session);
      expect((await store.vocabSessionGuard(session.id))?.value).toStrictEqual({
        id: session.id,
        finishedAt: null,
      });
    }
    const savedReviews = await store.vocabReviewsOf(session.id);
    expect(savedReviews.map((review) => review.id).sort()).toStrictEqual(
      answers.map((answer) => answer.id).sort(),
    );
    const savedItems = await store.vocabItemsByIds(deck);
    for (const cardId of deck) {
      expect(savedItems.get(cardId)?.version).toBe(2);
      expect(savedItems.get(cardId)?.value.state?.reps).toBe(2);
    }
    await prepareVocabReadModels(h.deps, h.context());
    const finished = await api.call("POST", finishPath, pending);
    expect(finished.status).toBe(200);
    const summary = vocabSummarySchema.parse(await finished.json());
    expect(summary).toMatchObject({
      sessionId: session.id,
      answered: 257,
      new: 0,
      day: session.day,
    });
    expect(summary.again.map((card) => card.cardId)).toStrictEqual([deck[0]]);
    const closed = await store.vocabSession(session.id);
    expect(closed?.value).toStrictEqual({
      ...session,
      finishedAt: NOON,
      tomorrow: summary.tomorrow,
    });
    expect((await store.vocabSessionGuard(session.id))?.value).toStrictEqual({
      id: session.id,
      finishedAt: NOON,
    });
    const kept = await api.call("POST", finishPath, { answers: [] });
    expect(kept.status).toBe(200);
    expect(vocabSummarySchema.parse(await kept.json())).toStrictEqual(summary);
    for (let offset = 0; offset < answers.length; offset += 20) {
      const replay = await api.call("POST", answerPath, {
        answers: answers.slice(offset, offset + 20),
      });
      expect(replay.status).toBe(204);
      expect(await replay.text()).toBe("");
    }
    const fresh = await api.call("POST", answerPath, {
      answers: [{ ...answers[0], id: "new-after-close" }],
    });
    expect(fresh.status).toBe(409);
    expect(errorResponseSchema.parse(await fresh.json()).error.code).toBe(
      "ERR_SESSION_CLOSED",
    );
    expect(await store.vocabReviewsOf(session.id)).toStrictEqual(savedReviews);
    expect(await store.vocabItemsByIds(deck)).toStrictEqual(savedItems);
    expect((await store.vocabSession(session.id))?.value.deck).toStrictEqual(deck);
  });
});
