import { describe, expect, it } from "vitest";

import { learnerId, type LearnerStore } from "@instant-composition/application";
import {
  errorResponseSchema,
  ROUTES,
  vocabSessionSchema,
} from "@instant-composition/contracts";

import {
  makePersonalCard,
  makeStats,
  makeVocabProgress,
  makeVocabReview,
} from "./application-fixtures";
import { makeApi, subjectAuthenticator, type ApiHarness } from "./api-harness";

// The vocabulary routes over HTTP, on the in-memory store and the fixture
// catalog's forty cards: the hub, a session from start to finish, the weak
// cards, the limits in the settings, and another learner's session.

async function contracted(response: Response, operationId: string): Promise<unknown> {
  const entry = ROUTES.find((candidate) => candidate.operationId === operationId);
  expect(response.status).toBe(entry?.success.status);
  if (entry?.success.body === null) {
    return undefined;
  }
  return entry?.success.body.parse(await response.json());
}

async function refusal(response: Response): Promise<[number, string]> {
  const body = errorResponseSchema.parse(await response.json());
  return [response.status, body.error.code];
}

/** The learner the API registered on its first request, placed at `level` by the drill. */
async function placedAt(api: ApiHarness, id: string, level = 4): Promise<LearnerStore> {
  expect((await api.call("GET", "/v1/vocab")).status).toBe(200);
  const store = api.stores.forLearner(learnerId(id));
  const stats = await store.stats();
  const value = makeStats({
    level: { level, reason: "placement", roundId: null, at: 0 },
  });
  const written = await store.commit(
    stats === undefined
      ? { puts: [{ type: "stats", value }], updates: [], expect: [] }
      : {
          puts: [],
          updates: [{ entry: { type: "stats", value }, version: stats.version }],
          expect: [],
        },
  );
  expect(written.ok).toBe(true);
  return store;
}

async function opened(api: ApiHarness, body: object) {
  return vocabSessionSchema.parse(
    await contracted(
      await api.call("POST", "/v1/vocab/sessions", body),
      "startVocabSession",
    ),
  );
}

function goodBatch(session: {
  readonly sessionId: string;
  readonly cards: readonly { readonly id: string }[];
}) {
  return {
    answers: session.cards.map((card) => ({
      id: `${session.sessionId}:${card.id}`,
      cardId: card.id,
      pass: "first",
      grade: "good",
      elapsedMs: 2_500,
    })),
  };
}

describe("the vocabulary hub", () => {
  it("shows a level-4 learner 10 new cards, no review and about 2 minutes", async () => {
    // Example 1.
    const api = makeApi();
    await placedAt(api, "learner-1");

    const hub = await contracted(await api.call("GET", "/v1/vocab"), "getVocab");

    expect(hub).toStrictEqual({
      empty: false,
      today: { due: 0, new: 10, minutes: 2 },
      categories: [
        { category: "word", due: 0, new: 3, learning: 0, total: 10 },
        { category: "idiom", due: 0, new: 3, learning: 0, total: 10 },
        { category: "phrasal-verb", due: 0, new: 2, learning: 0, total: 10 },
        { category: "phrase", due: 0, new: 2, learning: 0, total: 10 },
      ],
      weak: 0,
      tomorrow: 0,
    });
    expect(api.lines.at(-1)).toMatchObject({ operation: "getVocab", outcome: "ok" });
  });
});

describe("a session over HTTP", () => {
  it("deals today's queue, takes its answers, finishes, and leaves today done", async () => {
    // Example 2.
    const api = makeApi();
    await placedAt(api, "learner-1");
    const session = await opened(api, { sessionId: "s1", kind: "today" });
    const batch = goodBatch(session);

    const recorded = await api.call("POST", "/v1/vocab/sessions/s1/answers", batch);
    const resent = await api.call("POST", "/v1/vocab/sessions/s1/answers", batch);
    const summary = await contracted(
      await api.call("POST", "/v1/vocab/sessions/s1/finish", { answers: [] }),
      "finishVocabSession",
    );
    const hub = await contracted(await api.call("GET", "/v1/vocab"), "getVocab");

    expect(session.cards).toHaveLength(10);
    expect(session.cards.every((card) => card.isNew)).toBe(true);
    expect(session.cards[0]?.intervals).toStrictEqual({ again: 1, hard: 2, good: 3 });
    expect([recorded.status, resent.status]).toStrictEqual([204, 204]);
    expect(summary).toMatchObject({ answered: 10, new: 10, again: [], tomorrow: 0 });
    expect(hub).toMatchObject({ today: { due: 0, new: 0, minutes: 0 } });
  });

  it("opens one session for a retried start", async () => {
    const api = makeApi();
    await placedAt(api, "learner-1");
    const first = await opened(api, {
      sessionId: "s1",
      kind: "today",
      category: "word",
    });
    const again = await opened(api, {
      sessionId: "s1",
      kind: "today",
      category: "word",
    });

    expect(again).toStrictEqual(first);
    expect(first.cards.map((card) => card.category)).toStrictEqual([
      "word",
      "word",
      "word",
    ]);
  });

  it("refuses a new answer once finished", async () => {
    const api = makeApi();
    await placedAt(api, "learner-1");
    const session = await opened(api, { sessionId: "s1", kind: "today" });
    await api.call("POST", "/v1/vocab/sessions/s1/finish", goodBatch(session));
    const [card] = session.cards;

    const late = await api.call("POST", "/v1/vocab/sessions/s1/answers", {
      answers: [
        { id: "late", cardId: card?.id, pass: "retry", grade: "good", elapsedMs: 1 },
      ],
    });

    expect(await refusal(late)).toStrictEqual([409, "ERR_SESSION_CLOSED"]);
  });

  it.each([
    ["an unknown kind", "/v1/vocab/sessions", { sessionId: "s1", kind: "review" }],
    [
      "an unknown category",
      "/v1/vocab/sessions",
      { sessionId: "s1", kind: "today", category: "verb" },
    ],
    [
      "an unknown grade",
      "/v1/vocab/sessions/s1/answers",
      {
        answers: [{ id: "a", cardId: "c", pass: "first", grade: "easy", elapsedMs: 1 }],
      },
    ],
    [
      "a session id of 65 characters",
      `/v1/vocab/sessions/${"x".repeat(65)}/finish`,
      { answers: [] },
    ],
  ])("refuses %s", async (_, path, body) => {
    const api = makeApi();
    expect(await refusal(await api.call("POST", path, body))).toStrictEqual([
      400,
      "ERR_BAD_REQUEST",
    ]);
  });

  it("refuses a card the session did not deal", async () => {
    const api = makeApi();
    await placedAt(api, "learner-1");
    await opened(api, { sessionId: "s1", kind: "today", category: "word" });

    const answered = await api.call("POST", "/v1/vocab/sessions/s1/answers", {
      answers: [
        { id: "a", cardId: "v_phrase-7-1", pass: "first", grade: "good", elapsedMs: 1 },
      ],
    });

    expect(await refusal(answered)).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });
});

describe("the weak session", () => {
  it("deals twenty of twenty-five weak cards, the least likely recalled first", async () => {
    // Example 4.
    const api = makeApi();
    const store = await placedAt(api, "learner-1");
    const ids = ["word", "idiom", "phrasal-verb"]
      .flatMap((category) =>
        [3, 4, 5, 6, 7].flatMap((level) =>
          [0, 1].map((index) => `v_${category}-${String(level)}-${String(index)}`),
        ),
      )
      .slice(0, 25);
    await store.commit({
      puts: ids.map((cardId, index) => ({
        type: "vocabItem" as const,
        value: {
          cardId,
          source: { kind: "catalog" as const },
          state: {
            stability: 1 + index * 0.5,
            difficulty: 8,
            reps: 12,
            lapses: 8,
            lastDay: "2026-09-12",
            dueDay: "2026-10-30",
          },
          firstDay: "2026-08-01",
        },
      })),
      updates: [],
      expect: [],
    });

    const hub = await contracted(await api.call("GET", "/v1/vocab"), "getVocab");
    const session = await opened(api, { sessionId: "w1", kind: "weak" });

    expect(hub).toMatchObject({ weak: 25 });
    expect(session.cards.map((card) => card.id)).toStrictEqual(ids.slice(0, 20));
    expect(session.cards.every((card) => !card.isNew)).toBe(true);
  });
});

describe("the vocabulary limits in the settings", () => {
  it("reads as 10 and 100 until chosen, takes an option and no limit, and refuses the rest", async () => {
    const api = makeApi();
    await api.call("PATCH", "/v1/settings", { topics: ["work"] });

    const page = await contracted(await api.call("GET", "/v1/settings"), "getSettings");
    const saved = await contracted(
      await api.call("PATCH", "/v1/settings", {
        vocabNewPerDay: 0,
        vocabReviewsPerDay: null,
      }),
      "updateSettings",
    );
    const refused = await Promise.all([
      api.call("PATCH", "/v1/settings", { vocabNewPerDay: 7 }),
      api.call("PATCH", "/v1/settings", { vocabReviewsPerDay: 0 }),
    ]);

    expect(page).toMatchObject({
      settings: { vocabNewPerDay: 10, vocabReviewsPerDay: 100 },
    });
    expect(saved).toMatchObject({
      settings: { vocabNewPerDay: 0, vocabReviewsPerDay: null },
    });
    expect(await Promise.all(refused.map(refusal))).toStrictEqual([
      [400, "ERR_BAD_REQUEST"],
      [400, "ERR_BAD_REQUEST"],
    ]);
    expect(
      await contracted(await api.call("GET", "/v1/vocab"), "getVocab"),
    ).toMatchObject({
      today: { new: 0 },
    });
  });
});

describe("another learner's session", () => {
  /** Learner A with session `s1` holding answers, and learner B on the same store. */
  async function twoLearners() {
    const a = makeApi({ authenticator: subjectAuthenticator("subject-a") });
    await placedAt(a, "learner-1");
    const session = await opened(a, { sessionId: "s1", kind: "today" });
    await a.call("POST", "/v1/vocab/sessions/s1/answers", goodBatch(session));
    const b = makeApi({
      stores: a.stores,
      directory: a.directory,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });
    const mine = a.stores.forLearner(learnerId("learner-1"));
    const snapshot = async () =>
      Promise.all([
        mine.vocabSession("s1"),
        mine.vocabReviewsOf("s1"),
        mine.vocabItems(),
      ]);
    return { a, b, session, snapshot };
  }

  it.each([
    ["recordVocabAnswers", "/v1/vocab/sessions/s1/answers"],
    ["finishVocabSession", "/v1/vocab/sessions/s1/finish"],
  ])("is not found by %s, and is left as it was", async (operation, path) => {
    // Example 5.
    const { a, b, session, snapshot } = await twoLearners();
    const before = await snapshot();

    const answered = await b.call("POST", path, goodBatch(session));

    expect(await refusal(answered)).toStrictEqual([404, "ERR_SESSION_NOT_FOUND"]);
    expect(await snapshot()).toStrictEqual(before);
    expect(b.lines).toMatchObject([{ operation, learnerId: "learner-b" }]);
    expect(a.lines.every((line) => line.learnerId === "learner-1")).toBe(true);
  });

  it("is not answered by startVocabSession: the same id opens the caller's own", async () => {
    const { b, snapshot } = await twoLearners();
    const before = await snapshot();

    const theirs = await opened(b, { sessionId: "s1", kind: "today" });

    expect(theirs.cards.every((card) => card.isNew)).toBe(true);
    expect(await snapshot()).toStrictEqual(before);
    expect(
      await b.stores.forLearner(learnerId("learner-b")).vocabReviewsOf("s1"),
    ).toStrictEqual([]);
  });

  it("does not show in the caller's hub", async () => {
    const { b } = await twoLearners();

    const hub = await contracted(await b.call("GET", "/v1/vocab"), "getVocab");

    expect(hub).toMatchObject({ today: { due: 0, new: 10 }, weak: 0, tomorrow: 0 });
    expect(
      (hub as { categories: { learning: number }[] }).categories.map(
        (row) => row.learning,
      ),
    ).toStrictEqual([0, 0, 0, 0]);
  });
});

describe("deleting a personal card", () => {
  /** Learner A holding personal card `p_card00000001`, new, with an answer logged, and learner B on the same store. */
  async function twoLearners() {
    const a = makeApi({ authenticator: subjectAuthenticator("subject-a") });
    const mine = await placedAt(a, "learner-1");
    const card = makePersonalCard();
    const progress = makeVocabProgress({
      cardId: card.id,
      source: { kind: "talk", talkId: "t1", turn: 2 },
      state: null,
      firstDay: null,
    });
    const review = makeVocabReview({ cardId: card.id });
    const written = await mine.commit({
      puts: [
        { type: "card", value: card },
        { type: "vocabItem", value: progress },
        { type: "vocabReview", value: review },
      ],
      updates: [],
      expect: [],
    });
    expect(written.ok).toBe(true);
    const b = makeApi({
      stores: a.stores,
      directory: a.directory,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });
    return { a, b, mine, card, review };
  }

  it("removes the card and its progress, keeps its answers, and deals it no more", async () => {
    const { a, mine, card, review } = await twoLearners();
    const before = vocabSessionSchema.parse(
      await contracted(
        await a.call("POST", "/v1/vocab/sessions", { sessionId: "w1", kind: "weak" }),
        "startVocabSession",
      ),
    );
    expect(before.cards.map(({ id, personal }) => [id, personal])).toStrictEqual([
      [card.id, true],
    ]);

    await contracted(
      await a.call("DELETE", `/v1/vocab/cards/${card.id}`),
      "deleteVocabCard",
    );

    expect(await mine.card(card.id)).toBeUndefined();
    expect((await mine.vocabItems()).has(card.id)).toBe(false);
    expect(await mine.vocabReviewsOf("s1")).toStrictEqual([review]);
    const after = await opened(a, { sessionId: "w2", kind: "weak" });
    expect(after.cards).toStrictEqual([]);
    expect(
      await refusal(await a.call("DELETE", `/v1/vocab/cards/${card.id}`)),
    ).toStrictEqual([404, "ERR_CARD_NOT_FOUND"]);
  });

  it("is not found by another learner, and leaves the card as it was", async () => {
    // Example 5.
    const { b, mine, card } = await twoLearners();
    const before = await Promise.all([mine.card(card.id), mine.vocabItems()]);

    expect(
      await refusal(await b.call("DELETE", `/v1/vocab/cards/${card.id}`)),
    ).toStrictEqual([404, "ERR_CARD_NOT_FOUND"]);
    expect(await Promise.all([mine.card(card.id), mine.vocabItems()])).toStrictEqual(
      before,
    );
    expect(b.lines).toMatchObject([
      { operation: "deleteVocabCard", learnerId: "learner-b" },
    ]);
  });

  it("refuses a catalog card with 403 ERR_CARD_NOT_PERSONAL, and a path it cannot read with 400", async () => {
    const { a } = await twoLearners();

    expect(
      await refusal(await a.call("DELETE", "/v1/vocab/cards/v_word-3-0")),
    ).toStrictEqual([403, "ERR_CARD_NOT_PERSONAL"]);
    expect(
      await refusal(await a.call("DELETE", `/v1/vocab/cards/${"x".repeat(65)}`)),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });
});
