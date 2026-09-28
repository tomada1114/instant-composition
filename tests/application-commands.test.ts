import { describe, expect, it } from "vitest";

import {
  finishRound,
  learnerId,
  recordAnswers,
  startRound,
  updateSettings,
  type LearnerStore,
  type RoundPayload,
} from "@instant-composition/application";

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

async function onboard(
  h: Harness,
  dailySize: 5 | 10 | 15 | 20 | 30 = 10,
): Promise<void> {
  const saved = await updateSettings(h.deps, h.context(), {
    topics: ["work", "travel"],
    dailySize,
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
   * Placed, then two extra rounds that miss every `WEAK` card or none, then a
   * third. All on one day, so the third deals only unseen cards: a missed card
   * coming back as a review cannot account for the difference.
   */
  async function thirdExtra(missWeak: boolean): Promise<RoundPayload> {
    const h = makeHarness(fixedCatalog(snapshot));
    await placed(h);
    for (const roundId of ["e1", "e2"]) {
      const round = await start(h, "extra", roundId);
      const finished = await finishRound(h.deps, h.context(), {
        roundId,
        answers: answersFor(round, (cardId) =>
          missWeak && isWeak(cardId) ? "ng" : "ok",
        ),
      });
      expect(finished.ok).toBe(true);
    }
    return start(h, "extra", "e3");
  }

  it("deals more cards of that concept than the same history without the misses", async () => {
    const missed = await thirdExtra(true);
    const clean = await thirdExtra(false);

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
      expect(items.get(cardId)?.value.memory).toMatchObject({
        box: 0,
        lastDay: "2026-09-23",
        dueDay: "2026-09-24",
      });
    }
  });

  it("takes in a batch larger than one commit may hold", async () => {
    const h = makeHarness();
    await placed(h);
    await updateSettings(h.deps, h.context(), { dailySize: 30 });
    const round = await start(h, "today", "t1");
    const firsts = answersFor(round, () => "ng");
    const retries = firsts.map((answer) => ({
      ...answer,
      id: `${round.id}:r:${answer.cardId}`,
      pass: "retry" as const,
      result: "ok" as const,
    }));

    const finished = await finishRound(h.deps, h.context(), {
      roundId: round.id,
      answers: [...firsts, ...retries],
    });

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
    expect(stats?.value.completedDays).toStrictEqual(["2026-09-22"]);
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

  it("completes today's portion there and then when the new size is already met", async () => {
    const h = makeHarness();
    await placed(h);
    const tomorrow = NOON + DAY_MS;
    const round = await start(h, "today", "t2", tomorrow);
    await recordAnswers(h.deps, h.context(tomorrow), {
      roundId: round.id,
      answers: answersFor(round).slice(0, 5),
    });

    const saved = await updateSettings(h.deps, h.context(tomorrow), { dailySize: 5 });

    expect(saved.ok && saved.value.completedToday).toBe(true);
    const store = h.stores.forLearner(h.learner);
    expect((await store.round(round.id))?.value.finishedAt).toBe(tomorrow);
    expect((await store.stats())?.value.completedDays).toStrictEqual([
      "2026-09-22",
      "2026-09-23",
    ]);
  });

  it("cuts the open round's deck when the new size is not yet met", async () => {
    const h = makeHarness();
    await placed(h);
    const tomorrow = NOON + DAY_MS;
    const round = await start(h, "today", "t2", tomorrow);
    await recordAnswers(h.deps, h.context(tomorrow), {
      roundId: round.id,
      answers: answersFor(round).slice(0, 2),
    });

    const saved = await updateSettings(h.deps, h.context(tomorrow), { dailySize: 5 });

    expect(saved.ok && saved.value.completedToday).toBe(false);
    const store = h.stores.forLearner(h.learner);
    expect((await store.round(round.id))?.value.deck).toHaveLength(5);
    expect((await store.portion("2026-09-23"))?.value.target).toBe(5);
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
