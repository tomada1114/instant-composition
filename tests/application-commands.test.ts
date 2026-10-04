import { settleComposition } from "./composition-maintenance-harness";
import { describe, expect, it } from "vitest";

import {
  finishRound,
  home,
  learnerId,
  recordAnswers,
  startRound,
  updateLevel,
  updateSettings,
  type LearnerStore,
  type RoundPayload,
} from "@instant-composition/application";
import type { DrillNewPerDay } from "@instant-composition/domain";

import {
  answersFor,
  DAY_MS,
  fixedCatalog,
  makeHarness,
  makeSnapshot,
  NOON,
  unreadableCatalog,
  type Harness,
} from "./application-harness";

async function onboard(h: Harness, newPerDay: DrillNewPerDay = 5): Promise<void> {
  const saved = await updateSettings(h.deps, h.context(), {
    topics: ["work", "travel"],
    newPerDay,
  });
  expect(saved.ok).toBe(true);
}

async function start(
  h: Harness,
  kind: "placement" | "today" | "yesterday" | "extra",
  roundId: string,
  now = NOON,
): Promise<RoundPayload> {
  const started = await startRound(h.deps, h.context(now), { kind, roundId });
  if (!started.ok) {
    throw new Error(`Starting ${kind} failed with ${started.error.code}.`);
  }
  return started.value;
}

/** Onboarded and placed; the placement round filled today's portion of 10. */
async function placed(h: Harness): Promise<void> {
  await onboard(h);
  const round = await start(h, "placement", "p1");
  const finished = await finishRound(h.deps, h.context(), {
    roundId: round.id,
    answers: answersFor(round),
  });
  expect(finished.ok).toBe(true);
}

/** Every read of the learner's store, versions included. */
async function everything(store: LearnerStore): Promise<unknown> {
  return {
    settings: await store.settings(),
    stats: await store.stats(),
    reviews: await store.reviews(),
    items: [...(await store.items())],
  };
}

describe("startRound", () => {
  it("refuses a round before the settings exist", async () => {
    const h = makeHarness();
    expect(
      await startRound(h.deps, h.context(), { kind: "today", roundId: "r1" }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });

  it("deals a placement of ten cards, easiest first, with no retry pass", async () => {
    const h = makeHarness();
    await onboard(h);

    const round = await start(h, "placement", "p1");

    expect(round.deck).toHaveLength(10);
    expect(round.retries).toBe(false);
    expect(round.deck.map((id) => round.cards[id]?.level)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("hands back the round a retried start already made", async () => {
    const h = makeHarness();
    await onboard(h);

    const first = await start(h, "placement", "p1");
    const again = await start(h, "placement", "p1");
    const store = h.stores.forLearner(h.learner);

    expect(again).toStrictEqual(first);
    expect(
      (await store.days(["2026-09-22"])).get("2026-09-22")?.value.roundsStarted,
    ).toBe(1);
  });

  it("resumes today's open round of the same kind under a new id", async () => {
    const h = makeHarness();
    await placed(h);

    const extra = await start(h, "extra", "e1");
    const resumed = await start(h, "extra", "e2");

    expect(resumed.id).toBe(extra.id);
    expect(resumed.deck).toStrictEqual(extra.deck);
  });

  it("deals an extra round when today's portion is already done", async () => {
    const h = makeHarness();
    await placed(h);

    const round = await start(h, "today", "t1");

    expect(round.kind).toBe("extra");
    expect(round.portionDay).toBeNull();
  });

  it("abandons an open round of another kind, which still takes answers", async () => {
    const h = makeHarness();
    await placed(h);
    const extra = await start(h, "extra", "e1");
    await start(h, "placement", "p2", NOON + 1_000);

    const store = h.stores.forLearner(h.learner);
    const recorded = await recordAnswers(h.deps, h.context(), {
      roundId: extra.id,
      answers: answersFor(extra).slice(0, 1),
    });

    expect((await store.round(extra.id))?.value.abandonedAt).toBe(NOON + 1_000);
    expect((await store.stats())?.value.openRound).toStrictEqual({
      id: "p2",
      day: "2026-09-22",
    });
    expect(recorded.ok).toBe(true);
    expect(await store.reviewsOf(extra.id)).toHaveLength(1);
  });

  it("refuses to make up yesterday when there is nothing to make up", async () => {
    const h = makeHarness();
    await placed(h);

    expect(
      await startRound(h.deps, h.context(), { kind: "yesterday", roundId: "y1" }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_ROUND_CLOSED" } });
  });

  it("answers a catalog that cannot be read with ERR_CONTENT_UNREADABLE", async () => {
    const h = makeHarness(unreadableCatalog);
    expect(
      await startRound(h.deps, h.context(), { kind: "today", roundId: "r1" }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONTENT_UNREADABLE", reason: "missing" },
    });
  });

  it("refuses an agent that was not granted the command", async () => {
    const h = makeHarness();
    const context = {
      ...h.context(),
      actor: {
        kind: "agent" as const,
        onBehalfOf: h.learner,
        grants: ["home" as const],
      },
    };
    expect(
      await startRound(h.deps, context, { kind: "today", roundId: "r1" }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_FORBIDDEN" },
    });
  });
});

describe("a learner whose cards were scheduled under Leitner", () => {
  /** Placed on 2026-09-22, then every item rewritten as stored before FSRS: box 3, no state. */
  async function leitnerEra(h: Harness): Promise<readonly string[]> {
    await placed(h);
    const store = h.stores.forLearner(h.learner);
    const items = await store.items();
    const written = await store.commit({
      puts: [],
      updates: [...items.values()].map(({ value, version }) => {
        const { fsrs, ...rest } = value;
        expect(fsrs).toBeDefined();
        return {
          entry: {
            type: "item" as const,
            value: {
              ...rest,
              memory: {
                box: 3,
                dueDay: "2026-09-29",
                lastDay: "2026-09-22",
                seenCount: 3,
              },
            },
          },
          version,
        };
      }),
      expect: [],
    });
    expect(written.ok).toBe(true);
    return [...items.keys()];
  }

  it("deals those cards in the review quota as not new, with a new card's 1, 2 and 3 days", async () => {
    const h = makeHarness();
    const old = await leitnerEra(h);
    const round = await start(h, "today", "t1", NOON + DAY_MS);
    const dealt = old.filter((id) => round.deck.includes(id));
    expect(dealt).toStrictEqual(old);
    for (const id of old) {
      expect(round.cards[id]).toMatchObject({
        isNew: false,
        intervals: { again: 1, hard: 2, good: 3 },
      });
    }
    expect(round.deck.filter((id) => round.cards[id]?.isNew === true)).toHaveLength(5);
  });

  it("schedules one graded good due in 3 days, keeping its Leitner state unread", async () => {
    const h = makeHarness();
    const [cardId] = await leitnerEra(h);
    if (cardId === undefined) throw new Error("No items.");
    await start(h, "today", "t1", NOON + DAY_MS);
    const recorded = await recordAnswers(h.deps, h.context(NOON + DAY_MS), {
      roundId: "t1",
      answers: [
        {
          id: `t1:f:${cardId}`,
          roundId: "t1",
          cardId,
          pass: "first",
          grade: "good",
          elapsedMs: 3_000,
        },
      ],
    });
    expect(recorded.ok).toBe(true);
    const item = (await h.stores.forLearner(h.learner).items()).get(cardId)?.value;
    expect(item).toMatchObject({
      memory: { box: 3, dueDay: "2026-09-29" },
      fsrs: { reps: 1, lapses: 0, lastDay: "2026-09-23", dueDay: "2026-09-26" },
    });
  });
});

describe("startRound after misses on one grammar concept", () => {
  const WEAK = "en:grammar/passive";
  const snapshot = makeSnapshot({
    perLevel: 10,
    concepts: [
      WEAK,
      "en:grammar/can",
      "en:grammar/will",
      "en:grammar/must",
      "en:grammar/if",
    ],
  });
  const isWeak = (cardId: string): boolean =>
    snapshot.shown.get(cardId)?.concepts.includes(WEAK) ?? false;

  /**
   * Placed, then four extra rounds of five that miss every `WEAK` card or
   * none, then a fifth. All on one day, so the fifth deals only unseen cards:
   * a missed card coming back as a review cannot account for the difference.
   */
  async function fifthExtra(missWeak: boolean): Promise<RoundPayload> {
    const h = makeHarness(fixedCatalog(snapshot));
    await placed(h);
    for (const roundId of ["e1", "e2", "e3", "e4"]) {
      const round = await start(h, "extra", roundId);
      const finished = await finishRound(h.deps, h.context(), {
        roundId,
        answers: answersFor(round, (cardId) =>
          missWeak && isWeak(cardId) ? "ng" : "ok",
        ),
      });
      expect(finished.ok).toBe(true);
    }
    return start(h, "extra", "e5");
  }

  it("deals more cards of that concept than the same history without the misses", async () => {
    const missed = await fifthExtra(true);
    const clean = await fifthExtra(false);

    expect(missed.deck.filter(isWeak).length).toBeGreaterThan(
      clean.deck.filter(isWeak).length,
    );
  });
});

describe("recordAnswers", () => {
  it("changes nothing when a batch is sent again", async () => {
    const h = makeHarness();
    await placed(h);
    const round = await start(h, "extra", "e1");
    const batch = { roundId: round.id, answers: answersFor(round).slice(0, 4) };
    const store = h.stores.forLearner(h.learner);

    expect((await recordAnswers(h.deps, h.context(), batch)).ok).toBe(true);
    const once = await everything(store);
    expect((await recordAnswers(h.deps, h.context(NOON + 1_000), batch)).ok).toBe(true);

    expect(await everything(store)).toStrictEqual(once);
  });

  it("refuses the whole batch when one answer names a card outside the deck", async () => {
    const h = makeHarness();
    await placed(h);
    const round = await start(h, "extra", "e1");
    const answers = [
      ...answersFor(round).slice(0, 2),
      {
        id: "stray",
        roundId: round.id,
        cardId: "not-in-the-deck",
        pass: "first" as const,
        result: "ok" as const,
        elapsedMs: 1,
      },
    ];

    expect(
      await recordAnswers(h.deps, h.context(), { roundId: round.id, answers }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
    expect(await h.stores.forLearner(h.learner).reviewsOf(round.id)).toStrictEqual([]);
  });

  it("refuses an answer for a round that does not exist", async () => {
    const h = makeHarness();
    await placed(h);
    expect(
      await recordAnswers(h.deps, h.context(), { roundId: "nope", answers: [] }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_ROUND_NOT_FOUND" } });
  });

  it("changes nothing when a batch is sent again after the round is finished", async () => {
    const h = makeHarness();
    await placed(h);
    const round = await start(h, "extra", "e1");
    const batch = { roundId: round.id, answers: answersFor(round).slice(0, 4) };
    const store = h.stores.forLearner(h.learner);
    expect((await recordAnswers(h.deps, h.context(), batch)).ok).toBe(true);
    expect(
      (await finishRound(h.deps, h.context(), { roundId: round.id, answers: [] })).ok,
    ).toBe(true);
    const finished = await everything(store);

    expect(await recordAnswers(h.deps, h.context(NOON + 1_000), batch)).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(await everything(store)).toStrictEqual(finished);
  });

  it("refuses a new answer for a finished round", async () => {
    const h = makeHarness();
    await placed(h);
    const [answered] = await h.stores.forLearner(h.learner).reviewsOf("p1");

    expect(
      await recordAnswers(h.deps, h.context(), {
        roundId: "p1",
        answers: [
          {
            id: "late",
            roundId: "p1",
            cardId: answered?.item.id ?? "",
            pass: "first",
            result: "ok",
            elapsedMs: 1,
          },
        ],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_ROUND_CLOSED" } });
  });

  it("holds a client's answeredAt between the round's start and the server's time", async () => {
    const h = makeHarness();
    await placed(h);
    const round = await start(h, "extra", "e1", NOON + 1_000);
    const [early, late, inside] = answersFor(round);
    if (early === undefined || late === undefined || inside === undefined) {
      throw new Error("The deck is too small.");
    }

    await recordAnswers(h.deps, h.context(NOON + 60_000), {
      roundId: round.id,
      answers: [
        { ...early, answeredAt: NOON - DAY_MS },
        { ...late, answeredAt: NOON + DAY_MS },
        { ...inside, answeredAt: NOON + 30_000 },
      ],
    });

    const logged = await h.stores.forLearner(h.learner).reviewsOf(round.id);
    expect(logged.map((entry) => [entry.item.id, entry.answeredAt])).toStrictEqual([
      [early.cardId, NOON + 1_000],
      [inside.cardId, NOON + 30_000],
      [late.cardId, NOON + 60_000],
    ]);
  });

  it("takes a late round's answers on its own day, never rewinding an item a later round moved", async () => {
    const h = makeHarness();
    await placed(h);
    const early = await start(h, "today", "t1", NOON + DAY_MS);
    const later = await start(h, "today", "t2", NOON + 2 * DAY_MS);
    const store = h.stores.forLearner(h.learner);
    await recordAnswers(h.deps, h.context(NOON + 2 * DAY_MS + 60_000), {
      roundId: later.id,
      answers: answersFor(later),
    });
    const moved = new Map(
      [...(await store.items())].map(([id, stored]) => [id, stored.value]),
    );
    const both = early.deck.filter((cardId) => later.deck.includes(cardId));
    const only = early.deck.filter((cardId) => !later.deck.includes(cardId));
    expect(both.length).toBeGreaterThan(0);
    expect(only.length).toBeGreaterThan(0);

    await recordAnswers(h.deps, h.context(NOON + 2 * DAY_MS + 120_000), {
      roundId: early.id,
      answers: answersFor(early, () => "ng").map((answer, index) => ({
        ...answer,
        answeredAt: NOON + DAY_MS + 10_000 + index * 1_000,
      })),
    });

    const items = await store.items();
    expect(
      (await store.reviewsOf(early.id)).every((entry) => entry.day === "2026-09-23"),
    ).toBe(true);
    for (const cardId of both) {
      expect(items.get(cardId)?.value).toStrictEqual(moved.get(cardId));
    }
    for (const cardId of only) {
      expect(items.get(cardId)?.value.fsrs).toMatchObject({
        reps: 1,
        lastDay: "2026-09-23",
        dueDay: "2026-09-24",
      });
    }
  });

  it("takes in a batch larger than one commit may hold", async () => {
    const h = makeHarness();
    await placed(h);
    await updateSettings(h.deps, h.context(), { newPerDay: 15 });
    const tomorrow = NOON + DAY_MS;
    const round = await start(h, "today", "t1", tomorrow);
    const firsts = answersFor(round, () => "ng");
    const retries = firsts.map((answer) => ({
      ...answer,
      id: `${round.id}:r:${answer.cardId}`,
      pass: "retry" as const,
      result: "ok" as const,
    }));

    const finished = await finishRound(h.deps, h.context(tomorrow), {
      roundId: round.id,
      answers: [...firsts, ...retries],
    });

    expect(firsts).toHaveLength(15);
    expect(finished.ok && finished.value.totals.added).toBe(firsts.length * 2);
  });
});

describe("finishRound", () => {
  it("sets the level a placement measured, and completes the portion it counted toward", async () => {
    const h = makeHarness();
    await onboard(h);
    const round = await start(h, "placement", "p1");

    const finished = await finishRound(h.deps, h.context(), {
      roundId: round.id,
      answers: answersFor(round),
    });

    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.value.placement).toStrictEqual({
      level: 10,
      toeic: "1000",
      first: true,
    });
    expect(finished.value.portionCompleted).toBe(true);
    expect(finished.value.points).toStrictEqual({ earned: 20, total: 20 });
    const stats = await h.stores.forLearner(h.learner).stats();
    expect(stats?.value).not.toHaveProperty("completedDays");
    expect(stats?.value.streak).toStrictEqual({ schema: 1, longest: 1 });
    expect(stats?.value.openRound).toBeNull();
  });

  it("answers a second finish with the summary it kept", async () => {
    const h = makeHarness();
    await onboard(h);
    const round = await start(h, "placement", "p1");
    const command = { roundId: round.id, answers: answersFor(round) };

    const first = await finishRound(h.deps, h.context(), command);
    const second = await finishRound(h.deps, h.context(NOON + DAY_MS), command);

    expect(second).toStrictEqual(first);
  });

  it("refuses to finish a round that does not exist", async () => {
    const h = makeHarness();
    expect(
      await finishRound(h.deps, h.context(), { roundId: "nope", answers: [] }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_ROUND_NOT_FOUND" },
    });
  });

  it("carries the streak into the next day", async () => {
    const h = makeHarness();
    await placed(h);
    const tomorrow = NOON + DAY_MS;
    const round = await start(h, "today", "t2", tomorrow);

    const finished = await finishRound(h.deps, h.context(tomorrow), {
      roundId: round.id,
      answers: answersFor(round),
    });

    expect(finished.ok && finished.value.streak).toStrictEqual({
      value: 2,
      restart: false,
      changed: true,
    });
  });
});

describe("updateSettings", () => {
  it("refuses to remove the last topic", async () => {
    const h = makeHarness();
    expect(await updateSettings(h.deps, h.context(), { topics: [] })).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });

  it("completes today's portion there and then when a lower limit is already met", async () => {
    const h = makeHarness();
    await placed(h);
    await updateSettings(h.deps, h.context(), { newPerDay: 10 });
    const tomorrow = NOON + DAY_MS;
    const round = await start(h, "today", "t2", tomorrow);
    await recordAnswers(h.deps, h.context(tomorrow), {
      roundId: round.id,
      answers: answersFor(round).slice(0, 5),
    });

    const saved = await updateSettings(h.deps, h.context(tomorrow), { newPerDay: 5 });

    expect(saved.ok && saved.value.completedToday).toBe(true);
    const store = h.stores.forLearner(h.learner);
    expect((await store.round(round.id))?.value.finishedAt).toBe(tomorrow);
    expect((await store.stats())?.value).not.toHaveProperty("completedDays");
    expect((await store.stats())?.value.streak).toStrictEqual({
      schema: 1,
      longest: 2,
    });
  });

  it("cuts the open round's deck when a lower limit is not yet met", async () => {
    const h = makeHarness();
    await placed(h);
    await updateSettings(h.deps, h.context(), { newPerDay: 10 });
    const tomorrow = NOON + DAY_MS;
    const round = await start(h, "today", "t2", tomorrow);
    expect(round.deck).toHaveLength(10);
    await recordAnswers(h.deps, h.context(tomorrow), {
      roundId: round.id,
      answers: answersFor(round).slice(0, 2),
    });

    const saved = await updateSettings(h.deps, h.context(tomorrow), { newPerDay: 5 });

    expect(saved.ok && saved.value.completedToday).toBe(false);
    const store = h.stores.forLearner(h.learner);
    expect((await store.round(round.id))?.value.deck).toHaveLength(5);
    expect((await store.portion("2026-09-23"))?.value.target).toBe(5);
  });
});

describe("updateLevel", () => {
  /** The fixture's cards under the TOEIC references `content/levels.json` gives each level. */
  const TOEIC = ["300", "400", "500", "600", "730", "800", "860", "900", "950", "990+"];
  const withToeic = () => {
    const snapshot = makeSnapshot();
    return makeHarness(
      fixedCatalog({
        ...snapshot,
        levels: new Map(
          TOEIC.map((toeic, index) => [index + 1, { cefr: "B1", toeic }] as const),
        ),
      }),
    );
  };
  const MINUTE = 60_000;

  /** Starts a round of `kind` and finishes it with every first pass correct and fast. */
  async function playFast(
    h: Harness,
    kind: "today" | "extra",
    roundId: string,
    now: number,
  ) {
    const round = await start(h, kind, roundId, now);
    const finished = await finishRound(h.deps, h.context(now + MINUTE), {
      roundId: round.id,
      answers: answersFor(round, () => "ok", 1_000),
    });
    if (!finished.ok) throw new Error(`Finishing ${roundId} failed.`);
    return { round, summary: finished.value };
  }

  it("deals a learner who picks TOEIC 730 at onboarding level-5 decks, and never a placement", async () => {
    const h = withToeic();
    await onboard(h);
    const chosen = await updateLevel(h.deps, h.context(), { mode: "manual", level: 5 });
    expect(chosen).toStrictEqual({
      ok: true,
      value: { mode: "manual", level: 5, toeic: "730" },
    });

    await updateSettings(h.deps, h.context(), { newPerDay: 10 });
    await settleComposition(h.deps, h.context());
    const view = await home(h.deps, h.context());
    expect(view.ok && view.value.state.kind).toBe("ready");
    const round = await start(h, "today", "t1");
    const levels = Object.values(round.cards).map((card) => card.level);
    expect(round.kind).toBe("today");
    expect(levels).toHaveLength(10);
    expect(levels.every((level) => level >= 4 && level <= 7)).toBe(true);
    expect(levels.filter((level) => level === 5).length).toBeGreaterThanOrEqual(5);
  });

  it("keeps a level picked by hand where it is after thirty answers, then adjusts from it once switched to auto", async () => {
    const h = withToeic();
    await onboard(h, 15);
    await updateLevel(h.deps, h.context(), { mode: "manual", level: 5 });
    const store = h.stores.forLearner(h.learner);

    // Fifteen new cards today, then three extra rounds of five.
    const today = await playFast(h, "today", "t1", NOON + MINUTE);
    const extras = [];
    for (const [index, roundId] of ["x1", "x3", "x4"].entries()) {
      extras.push(await playFast(h, "extra", roundId, NOON + (2 + index) * MINUTE));
    }
    const kept = (await store.stats())?.value;
    expect(today.summary.difficulty).toBeNull();
    expect(extras.map((extra) => extra.summary.difficulty)).toStrictEqual([
      null,
      null,
      null,
    ]);
    expect(kept?.levelWindow).toHaveLength(30);
    expect(kept?.level).toMatchObject({ level: 5, reason: "chosen" });
    expect(kept?.levelMode).toBe("manual");

    const released = await updateLevel(h.deps, h.context(NOON + 5 * MINUTE + 1), {
      mode: "auto",
    });
    expect(released).toStrictEqual({
      ok: true,
      value: { mode: "auto", level: 5, toeic: "730" },
    });
    // Three rounds' probes answered right and fast clear level 7 as well as 6.
    const moved = await playFast(h, "extra", "x2", NOON + 6 * MINUTE);
    expect(moved.summary.difficulty).toStrictEqual({ change: "up", toeic: "860" });
    expect((await store.stats())?.value.level).toMatchObject({
      level: 7,
      reason: "up",
    });
  });

  it("puts a learner in auto when a placement measures the level", async () => {
    const h = withToeic();
    await onboard(h);
    await updateLevel(h.deps, h.context(), { mode: "manual", level: 2 });
    const round = await start(h, "placement", "p1");
    const finished = await finishRound(h.deps, h.context(), {
      roundId: round.id,
      answers: answersFor(round),
    });

    expect(finished.ok && finished.value.placement).toStrictEqual({
      level: 10,
      toeic: "990+",
      first: false,
    });
    const stats = (await h.stores.forLearner(h.learner).stats())?.value;
    expect(stats?.levelMode).toBe("auto");
    expect(stats?.level).toMatchObject({ level: 10, reason: "placement" });
  });

  it("writes nothing when the level is already held the way chosen", async () => {
    const h = withToeic();
    await placed(h);
    const store = h.stores.forLearner(h.learner);
    const before = await everything(store);

    const auto = await updateLevel(h.deps, h.context(), { mode: "auto" });

    expect(auto).toStrictEqual({
      ok: true,
      value: { mode: "auto", level: 10, toeic: "990+" },
    });
    expect(await everything(store)).toStrictEqual(before);
  });

  it("refuses a level off the catalog's scale and writes nothing", async () => {
    const h = withToeic();
    expect(
      await updateLevel(h.deps, h.context(), { mode: "manual", level: 11 }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    expect(await h.stores.forLearner(h.learner).stats()).toBeUndefined();
  });

  it("refuses an agent that was not granted the command", async () => {
    const h = makeHarness();
    const context = {
      ...h.context(),
      actor: {
        kind: "agent" as const,
        onBehalfOf: h.learner,
        grants: ["home" as const],
      },
    };
    expect(
      await updateLevel(h.deps, context, { mode: "manual", level: 5 }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_FORBIDDEN" } });
  });
});

describe("a learner's commands", () => {
  it("never reach another learner's data", async () => {
    const h = makeHarness();
    await placed(h);
    const other = h.stores.forLearner(learnerId("learner-b"));

    expect(await other.stats()).toBeUndefined();
    expect(await other.reviews()).toStrictEqual([]);
  });
});
