import { describe, expect, it } from "vitest";

import {
  deleteVocabCard,
  finishVocabSession,
  learnerId,
  recordVocabAnswers,
  startVocabSession,
  updateSettings,
  vocabHub,
  type RequestContext,
  type VocabSessionView,
} from "@instant-composition/application";
import type { VocabAnswer } from "@instant-composition/domain";

import { makePersonalCard, makeStats, makeVocabProgress } from "./application-fixtures";
import {
  DAY_MS,
  fixedCatalog,
  makeHarness,
  makeSnapshot,
  NOON,
  unreadableCatalog,
  type Harness,
} from "./application-harness";

/** A learner the drill placed at `level`. */
async function atLevel(h: Harness, level = 4): Promise<void> {
  const written = await h.stores.forLearner(h.learner).commit({
    puts: [
      {
        type: "stats",
        value: makeStats({
          level: { level, reason: "placement", roundId: null, at: 0 },
        }),
      },
    ],
    updates: [],
    expect: [],
  });
  expect(written.ok).toBe(true);
}

async function started(
  h: Harness,
  sessionId: string,
  kind: "today" | "extra" | "weak" = "today",
  context: RequestContext = h.context(),
): Promise<VocabSessionView> {
  const opened = await startVocabSession(h.deps, context, { sessionId, kind });
  if (!opened.ok) throw new Error(opened.error.code);
  return opened.value;
}

/** A first answer for every dealt card, each graded `grade`. */
function gradedAll(
  session: VocabSessionView,
  grade: VocabAnswer["grade"] = "good",
): VocabAnswer[] {
  return session.cards.map((card, index) => ({
    id: `${session.sessionId}:${card.id}`,
    cardId: card.id,
    pass: "first",
    grade,
    elapsedMs: 2_000,
    answeredAt: NOON + index,
  }));
}

/** The context of another learner, signed in on the same clock. */
function otherLearner(h: Harness): RequestContext {
  const context = h.context();
  const other = learnerId("learner-b");
  return {
    ...context,
    actor: { kind: "learner", learnerId: other },
    learner: { ...context.learner, id: other },
  };
}

describe("the hub", () => {
  it("shows a level-4 learner 10 new cards, no review, about 2 minutes, by category 3, 3, 2, 2", async () => {
    // Example 1.
    const h = makeHarness();
    await atLevel(h);

    const hub = await vocabHub(h.deps, h.context());

    expect(hub).toStrictEqual({
      ok: true,
      value: {
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
      },
    });
  });

  it("says the pair has no card when the catalog holds none", async () => {
    const h = makeHarness(fixedCatalog(makeSnapshot({ vocab: [] })));
    const hub = await vocabHub(h.deps, h.context());
    expect(hub.ok && hub.value).toMatchObject({
      empty: true,
      today: { due: 0, new: 0 },
    });
  });

  it("refuses to guess when the catalog cannot be read", async () => {
    const h = makeHarness(unreadableCatalog);
    expect(await vocabHub(h.deps, h.context())).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONTENT_UNREADABLE", reason: "missing" },
    });
  });

  it("takes a new limit from the next read", async () => {
    const h = makeHarness();
    await atLevel(h);
    await updateSettings(h.deps, h.context(), { topics: ["work"] });

    const saved = await updateSettings(h.deps, h.context(), { vocabNewPerDay: 5 });
    const hub = await vocabHub(h.deps, h.context());

    expect(saved.ok && saved.value.settings).toMatchObject({
      vocabNewPerDay: 5,
      vocabReviewsPerDay: 100,
    });
    expect(hub.ok && hub.value.today).toStrictEqual({ due: 0, new: 5, minutes: 1 });
  });
});

describe("a session of today's queue", () => {
  it("deals its cards with their faces, each grade's interval and whether it is new", async () => {
    const h = makeHarness();
    await atLevel(h);

    const session = await started(h, "s1");

    expect(session).toMatchObject({ sessionId: "s1", kind: "today", category: null });
    expect(session.day).toBe("2026-09-22");
    expect(session.cards).toHaveLength(10);
    expect(session.cards[0]).toStrictEqual({
      id: "v_word-3-0",
      category: "word",
      level: 3,
      definition: "What v_word-3-0 means.",
      example: "An example of {{headword}} for v_word-3-0.",
      headword: "headword v_word-3-0",
      meaning: "v_word-3-0の意味",
      example2: "Another example for v_word-3-0.",
      intervals: { again: 1, hard: 2, good: 3 },
      isNew: true,
      personal: false,
    });
  });

  it("opens one session for a retried start", async () => {
    const h = makeHarness();
    await atLevel(h);
    const first = await started(h, "s1");
    await recordVocabAnswers(h.deps, h.context(), {
      sessionId: "s1",
      answers: gradedAll(first).slice(0, 2),
    });

    const again = await started(h, "s1");

    expect(again.cards.map((card) => card.id)).toStrictEqual(
      first.cards.map((card) => card.id),
    );
  });

  it("restricted to a category, deals that category's share of today's queue", async () => {
    const h = makeHarness();
    await atLevel(h);
    const opened = await startVocabSession(h.deps, h.context(), {
      sessionId: "s1",
      kind: "today",
      category: "idiom",
    });
    expect(opened.ok && opened.value.cards.map((card) => card.id)).toStrictEqual([
      "v_idiom-3-0",
      "v_idiom-3-1",
      "v_idiom-4-0",
    ]);
  });

  it("graded good throughout, schedules each card three days on and leaves today done", async () => {
    // Example 2.
    const h = makeHarness();
    await atLevel(h);
    const session = await started(h, "s1");

    const summary = await finishVocabSession(h.deps, h.context(), {
      sessionId: "s1",
      answers: gradedAll(session),
    });
    const items = await h.stores.forLearner(h.learner).vocabItems();
    const hub = await vocabHub(h.deps, h.context());

    expect(summary).toStrictEqual({
      ok: true,
      value: {
        sessionId: "s1",
        kind: "today",
        category: null,
        day: "2026-09-22",
        answered: 10,
        new: 10,
        again: [],
        tomorrow: 0,
      },
    });
    expect([...items.values()].map(({ value }) => value.state?.dueDay)).toStrictEqual(
      Array.from({ length: 10 }, () => "2026-09-25"),
    );
    expect(hub.ok && hub.value.today).toStrictEqual({ due: 0, new: 0, minutes: 0 });
    expect(hub.ok && hub.value.categories.map((row) => row.learning)).toStrictEqual([
      3, 3, 2, 2,
    ]);
  });

  it("lists the first answers graded again with their headword and meaning, never a re-ask", async () => {
    const h = makeHarness();
    await atLevel(h);
    const session = await started(h, "s1");
    const [first, second] = session.cards;
    if (first === undefined || second === undefined) throw new Error("Too few cards.");

    const summary = await finishVocabSession(h.deps, h.context(), {
      sessionId: "s1",
      answers: [
        { id: "a1", cardId: first.id, pass: "first", grade: "again", elapsedMs: 9_000 },
        { id: "a2", cardId: second.id, pass: "first", grade: "good", elapsedMs: 2_000 },
        {
          id: "a3",
          cardId: second.id,
          pass: "retry",
          grade: "again",
          elapsedMs: 2_000,
        },
      ],
    });

    expect(summary.ok && summary.value).toMatchObject({
      answered: 2,
      new: 2,
      again: [{ cardId: first.id, headword: first.headword, meaning: first.meaning }],
      tomorrow: 1,
    });
  });

  it("takes a batch of sixty, re-asks included, over more than one commit", async () => {
    const h = makeHarness();
    await atLevel(h);
    await updateSettings(h.deps, h.context(), { topics: ["work"] });
    await updateSettings(h.deps, h.context(), { vocabNewPerDay: 30 });
    const session = await started(h, "s1");
    const firsts = gradedAll(session, "again");
    const reasks = firsts.map((answer) => ({
      ...answer,
      id: `${answer.id}:r`,
      pass: "retry" as const,
      grade: "good" as const,
    }));

    const recorded = await recordVocabAnswers(h.deps, h.context(), {
      sessionId: "s1",
      answers: [...firsts, ...reasks],
    });

    expect(recorded.ok).toBe(true);
    expect(await h.stores.forLearner(h.learner).vocabReviewsOf("s1")).toHaveLength(60);
  });
});

describe("a finished session", () => {
  it("answers the summary it kept, takes a resent batch and refuses a new answer", async () => {
    const h = makeHarness();
    await atLevel(h);
    const session = await started(h, "s1");
    const answers = gradedAll(session);
    const first = await finishVocabSession(h.deps, h.context(), {
      sessionId: "s1",
      answers,
    });

    const later = h.context(NOON + DAY_MS);
    expect(
      await finishVocabSession(h.deps, later, { sessionId: "s1", answers }),
    ).toStrictEqual(first);
    expect(
      await recordVocabAnswers(h.deps, later, { sessionId: "s1", answers }),
    ).toStrictEqual({ ok: true, value: undefined });
    expect(
      await recordVocabAnswers(h.deps, later, {
        sessionId: "s1",
        answers: [{ ...answers[0], id: "fresh" } as VocabAnswer],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_SESSION_CLOSED" } });
  });
});

describe("a session crossing into the next practice day", () => {
  it("counts a late answer for the day the session started", async () => {
    const h = makeHarness();
    await atLevel(h);
    const session = await started(h, "s1");
    const [answer] = gradedAll(session);
    if (answer === undefined) throw new Error("No card was dealt.");

    await recordVocabAnswers(h.deps, h.context(NOON + DAY_MS), {
      sessionId: "s1",
      answers: [{ ...answer, answeredAt: NOON + DAY_MS }],
    });

    const items = await h.stores.forLearner(h.learner).vocabItems();
    expect(items.get(answer.cardId)?.value).toMatchObject({
      firstDay: "2026-09-22",
      state: { lastDay: "2026-09-22", dueDay: "2026-09-25" },
    });
  });
});

describe("another learner", () => {
  it("finds none of a learner's session through any command, and changes nothing", async () => {
    const h = makeHarness();
    await atLevel(h);
    const session = await started(h, "s1");
    const other = otherLearner(h);
    const answers = gradedAll(session);
    const notFound = { ok: false, error: { code: "ERR_SESSION_NOT_FOUND" } };

    expect(
      await recordVocabAnswers(h.deps, other, { sessionId: "s1", answers }),
    ).toStrictEqual(notFound);
    expect(
      await finishVocabSession(h.deps, other, { sessionId: "s1", answers }),
    ).toStrictEqual(notFound);
    expect(await h.stores.forLearner(h.learner).vocabReviewsOf("s1")).toStrictEqual([]);
    expect((await h.stores.forLearner(h.learner).vocabSession("s1"))?.version).toBe(1);
  });

  it("starting a session of the same id opens their own, dealt from their own progress", async () => {
    const h = makeHarness();
    await atLevel(h);
    const mine = await started(h, "s1");
    await finishVocabSession(h.deps, h.context(), {
      sessionId: "s1",
      answers: gradedAll(mine),
    });

    const theirs = await started(h, "s1", "today", otherLearner(h));

    expect(theirs.cards.every((card) => card.isNew)).toBe(true);
    expect(
      (await h.stores.forLearner(h.learner).vocabSession("s1"))?.value.finishedAt,
    ).not.toBeNull();
    expect(
      (await h.stores.forLearner(learnerId("learner-b")).vocabSession("s1"))?.value
        .finishedAt,
    ).toBeNull();
  });
});

describe("what a vocabulary command refuses", () => {
  it("answers a session the learner does not have as not found", async () => {
    const h = makeHarness();
    const notFound = { ok: false, error: { code: "ERR_SESSION_NOT_FOUND" } };

    expect(
      await recordVocabAnswers(h.deps, h.context(), { sessionId: "none", answers: [] }),
    ).toStrictEqual(notFound);
    expect(
      await finishVocabSession(h.deps, h.context(), { sessionId: "none", answers: [] }),
    ).toStrictEqual(notFound);
  });

  it("refuses a finish naming a card the session did not deal, and keeps it open", async () => {
    const h = makeHarness();
    await atLevel(h);
    await started(h, "s1");

    const finished = await finishVocabSession(h.deps, h.context(), {
      sessionId: "s1",
      answers: [
        {
          id: "a1",
          cardId: "v_phrase-7-1",
          pass: "first",
          grade: "good",
          elapsedMs: 1,
        },
      ],
    });

    expect(finished).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    expect(
      (await h.stores.forLearner(h.learner).vocabSession("s1"))?.value.finishedAt,
    ).toBeNull();
  });

  it("refuses every command while the catalog cannot be read", async () => {
    let readable = true;
    const snapshot = makeSnapshot();
    const h = makeHarness({
      snapshot: () =>
        readable
          ? Promise.resolve({ ok: true, value: snapshot })
          : unreadableCatalog.snapshot(),
    });
    await atLevel(h);
    const session = await started(h, "s1");
    readable = false;
    const unreadable = {
      ok: false,
      error: { code: "ERR_CONTENT_UNREADABLE", reason: "missing" },
    };
    const command = { sessionId: "s1", answers: gradedAll(session) };

    expect(
      await startVocabSession(h.deps, h.context(), { sessionId: "s2", kind: "today" }),
    ).toStrictEqual(unreadable);
    expect(await recordVocabAnswers(h.deps, h.context(), command)).toStrictEqual(
      unreadable,
    );
    expect(await finishVocabSession(h.deps, h.context(), command)).toStrictEqual(
      unreadable,
    );
  });

  it("refuses an agent the learner granted none of them", async () => {
    const h = makeHarness();
    const context: RequestContext = {
      ...h.context(),
      actor: { kind: "agent", onBehalfOf: h.learner, grants: ["home"] },
    };
    const forbidden = { ok: false, error: { code: "ERR_FORBIDDEN" } };
    const command = { sessionId: "s1", answers: [] };

    expect(await vocabHub(h.deps, context)).toStrictEqual(forbidden);
    expect(
      await startVocabSession(h.deps, context, { sessionId: "s1", kind: "weak" }),
    ).toStrictEqual(forbidden);
    expect(await recordVocabAnswers(h.deps, context, command)).toStrictEqual(forbidden);
    expect(await finishVocabSession(h.deps, context, command)).toStrictEqual(forbidden);
    expect(
      await deleteVocabCard(h.deps, context, { cardId: "p_card00000001" }),
    ).toStrictEqual(forbidden);
  });
});

describe("a personal card", () => {
  const CARD = makePersonalCard();
  const NEW = makeVocabProgress({
    cardId: CARD.id,
    source: { kind: "talk", talkId: "t1", turn: 2 },
    state: null,
    firstDay: null,
  });

  /** A level-4 learner holding `cards`, each new and from a talk. */
  async function holding(h: Harness, cards = [CARD]): Promise<void> {
    await atLevel(h);
    const written = await h.stores.forLearner(h.learner).commit({
      puts: cards.flatMap((card) => [
        { type: "card" as const, value: card },
        { type: "vocabItem" as const, value: { ...NEW, cardId: card.id } },
      ]),
      updates: [],
      expect: [],
    });
    expect(written.ok).toBe(true);
  }

  it("is dealt first among today's new cards, weak, beside the catalog's", async () => {
    const h = makeHarness();
    await holding(h);

    const hub = await vocabHub(h.deps, h.context());
    const session = await started(h, "s1");

    expect(hub.ok && [hub.value.today.new, hub.value.weak]).toStrictEqual([10, 1]);
    expect(session.cards[0]).toMatchObject({
      id: CARD.id,
      headword: "catch up",
      example: CARD.example,
      meaning: "近況を話す",
      isNew: true,
      personal: true,
    });
    expect(session.cards.slice(1).every((card) => !card.personal)).toBe(true);
  });

  it("takes an answer and keeps where it came from", async () => {
    const h = makeHarness();
    await holding(h);
    const session = await started(h, "s1");

    const finished = await finishVocabSession(h.deps, h.context(), {
      sessionId: "s1",
      answers: gradedAll(session).filter((answer) => answer.cardId === CARD.id),
    });

    expect(finished.ok && finished.value.answered).toBe(1);
    expect(
      (await h.stores.forLearner(h.learner).vocabItems()).get(CARD.id)?.value,
    ).toMatchObject({ source: NEW.source, firstDay: "2026-09-22" });
    const [review] = await h.stores.forLearner(h.learner).vocabReviewsOf("s1");
    expect(review?.snapshot).toStrictEqual({
      headword: "catch up",
      meaning: "近況を話す",
      category: "idiom",
      level: 4,
    });
  });

  it("made for another language pair is not dealt", async () => {
    const h = makeHarness();
    await holding(h, [{ ...CARD, l1: "ko" }]);

    const hub = await vocabHub(h.deps, h.context());

    expect(hub.ok && hub.value.weak).toBe(0);
    expect((await started(h, "s1", "weak")).cards).toStrictEqual([]);
  });

  it("is deleted with its progress, its answers kept, and is dealt no more", async () => {
    const h = makeHarness();
    await holding(h);
    const store = h.stores.forLearner(h.learner);
    const session = await started(h, "s1");
    await recordVocabAnswers(h.deps, h.context(), {
      sessionId: "s1",
      answers: gradedAll(session).filter((answer) => answer.cardId === CARD.id),
    });

    expect(
      await deleteVocabCard(h.deps, h.context(), { cardId: CARD.id }),
    ).toStrictEqual({ ok: true, value: undefined });

    expect(await store.card(CARD.id)).toBeUndefined();
    expect((await store.vocabItems()).has(CARD.id)).toBe(false);
    expect(await store.vocabReviewsOf("s1")).toHaveLength(1);
    expect((await started(h, "s2", "weak")).cards).toStrictEqual([]);
    const resent = await started(h, "s1");
    expect(session.cards.map((card) => card.id)).toContain(CARD.id);
    expect(resent.cards.map((card) => card.id)).not.toContain(CARD.id);
  });

  it.each([
    ["a catalog card", "v_word-3-0", "ERR_CARD_NOT_PERSONAL"],
    ["an unknown card", "p_none", "ERR_CARD_NOT_FOUND"],
  ])("refuses to delete %s", async (_, cardId, code) => {
    const h = makeHarness();
    await holding(h);

    expect(await deleteVocabCard(h.deps, h.context(), { cardId })).toStrictEqual({
      ok: false,
      error: { code },
    });
    expect(await h.stores.forLearner(h.learner).card(CARD.id)).toBeDefined();
  });

  it("of another learner is not found, and stays", async () => {
    const h = makeHarness();
    await holding(h);

    expect(
      await deleteVocabCard(h.deps, otherLearner(h), { cardId: CARD.id }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_CARD_NOT_FOUND" } });
    expect((await h.stores.forLearner(h.learner).card(CARD.id))?.value).toStrictEqual(
      CARD,
    );
  });
});
