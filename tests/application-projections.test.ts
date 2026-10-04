import { describe, expect, it } from "vitest";

import {
  finishRound,
  recordAnswers,
  startRound,
  updateSettings,
  type LearnerStore,
  type LearnerStores,
} from "@instant-composition/application";
import { replayItems } from "@instant-composition/domain";
import { makeRound } from "./application-fixtures";
import { describeBoundedAnswerContract } from "./bounded-answer-contract";
import { describeFirstAnswerContract } from "./first-answer-contract";

import {
  answersFor,
  DAY_MS,
  makeHarness,
  NOON,
  type Harness,
} from "./application-harness";

describeBoundedAnswerContract(
  "application-projections.test.ts",
  () => makeHarness().stores,
);
describeFirstAnswerContract("first answers with memory", () => makeHarness().stores);

/** A placement, then five days of rounds with misses, retries and fast answers. */
async function fiveDays(h: Harness): Promise<void> {
  await updateSettings(h.deps, h.context(), { topics: ["work", "travel"] });
  const placement = await startRound(h.deps, h.context(), {
    kind: "placement",
    roundId: "p1",
  });
  if (!placement.ok) throw new Error(placement.error.code);
  await finishRound(h.deps, h.context(), {
    roundId: "p1",
    answers: answersFor(placement.value, (_, index) => (index < 5 ? "ok" : "ng")),
  });
  for (let day = 1; day <= 5; day += 1) {
    const now = NOON + day * DAY_MS;
    const started = await startRound(h.deps, h.context(now), {
      kind: "today",
      roundId: `t${String(day)}`,
    });
    if (!started.ok) throw new Error(started.error.code);
    const round = started.value;
    const firsts = answersFor(
      round,
      (_, index) => ((index + day) % 3 === 0 ? "ng" : "ok"),
      1_000 * day,
    );
    await recordAnswers(h.deps, h.context(now), {
      roundId: round.id,
      answers: firsts.slice(0, 4),
    });
    const retries = firsts
      .filter((answer) => answer.result === "ng")
      .map((answer) => ({
        ...answer,
        id: `${round.id}:r:${answer.cardId}`,
        pass: "retry" as const,
        result: "ok" as const,
      }));
    await finishRound(h.deps, h.context(now + 60_000), {
      roundId: round.id,
      answers: [...firsts.slice(4), ...retries],
    });
  }
}

/**
 * Day 1's round is left with its answers queued, day 2's round answers some of
 * the same cards, and then day 1's answers arrive, stamped with day 1's times.
 */
async function lateArrival(h: Harness): Promise<void> {
  await updateSettings(h.deps, h.context(), { topics: ["work", "travel"] });
  const placement = await startRound(h.deps, h.context(), {
    kind: "placement",
    roundId: "p1",
  });
  if (!placement.ok) throw new Error(placement.error.code);
  await finishRound(h.deps, h.context(), {
    roundId: "p1",
    answers: answersFor(placement.value),
  });
  const early = await startRound(h.deps, h.context(NOON + DAY_MS), {
    kind: "today",
    roundId: "t1",
  });
  const later = await startRound(h.deps, h.context(NOON + 2 * DAY_MS), {
    kind: "today",
    roundId: "t2",
  });
  if (!early.ok || !later.ok) throw new Error("A round did not start.");
  await finishRound(h.deps, h.context(NOON + 2 * DAY_MS + 60_000), {
    roundId: later.value.id,
    answers: answersFor(later.value, (_, index) => (index % 2 === 0 ? "ok" : "ng")),
  });
  await recordAnswers(h.deps, h.context(NOON + 2 * DAY_MS + 120_000), {
    roundId: early.value.id,
    answers: answersFor(early.value, (_, index) => (index % 3 === 0 ? "ng" : "ok")).map(
      (answer, index) => ({ ...answer, answeredAt: NOON + DAY_MS + index * 1_000 }),
    ),
  });
}

describe("the projections a command keeps", () => {
  it("replays two committed state changes in arrival order when their client times are reversed", async () => {
    const h = makeHarness();
    const store = h.stores.forLearner(h.learner);
    const cardId = "work-a-5-0";
    await store.commit({
      puts: [
        {
          type: "round",
          value: makeRound({
            id: "old",
            deck: [cardId],
            startedAt: NOON,
            abandonedAt: NOON + DAY_MS,
          }),
        },
        {
          type: "round",
          value: makeRound({
            id: "new",
            day: "2026-09-23",
            portionDay: "2026-09-23",
            deck: [cardId],
            startedAt: NOON + DAY_MS,
          }),
        },
      ],
      updates: [],
      expect: [],
    });
    const first = await recordAnswers(h.deps, h.context(NOON + DAY_MS + 120_000), {
      roundId: "old",
      answers: [
        {
          id: "old-answer",
          cardId,
          roundId: "old",
          pass: "first",
          result: "ok",
          elapsedMs: 1_000,
          answeredAt: NOON + DAY_MS + 60_000,
        },
      ],
    });
    const second = await recordAnswers(h.deps, h.context(NOON + DAY_MS + 180_000), {
      roundId: "new",
      answers: [
        {
          id: "new-answer",
          cardId,
          roundId: "new",
          pass: "first",
          result: "ok",
          elapsedMs: 1_000,
          answeredAt: NOON + DAY_MS + 30_000,
        },
      ],
    });
    const log = await store.reviews();
    const item = (await store.items()).get(cardId)?.value;

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(log.map((entry) => entry.revision)).toStrictEqual([2, 1]);
    expect(item).toMatchObject({ revision: 2, fsrs: { reps: 2 } });
    expect(replayItems(log).get(cardId)).toStrictEqual(item);
  });

  it("equal what replaying the review log rebuilds when a round's answers arrive late", async () => {
    const h = makeHarness();
    await lateArrival(h);
    const store = h.stores.forLearner(h.learner);
    const log = await store.reviews();
    const items = new Map(
      [...(await store.items())].map(([id, stored]) => [id, stored.value]),
    );

    expect(log.some((entry) => entry.sessionId === "t1")).toBe(true);
    expect(items).toStrictEqual(replayItems(log));
  });

  it("equal what replaying the review log rebuilds", async () => {
    const h = makeHarness();
    await fiveDays(h);
    const store = h.stores.forLearner(h.learner);
    const log = await store.reviews();
    const items = new Map(
      [...(await store.items())].map(([id, stored]) => [id, stored.value]),
    );

    expect(log.length).toBeGreaterThan(50);
    expect([...items.values()].some((item) => item.mastered !== null)).toBe(true);
    expect(items).toStrictEqual(replayItems(log));
  });

  it("keep the learner's totals and each day's tally in step with the log", async () => {
    const h = makeHarness();
    await fiveDays(h);
    const store = h.stores.forLearner(h.learner);
    const log = await store.reviews();
    const days = [...new Set(log.map((entry) => entry.day))].sort();
    const stats = (await store.stats())?.value;
    const tallies = await store.days(days);

    expect(stats?.said).toBe(log.length);
    expect(stats?.practicedDays).toBe(days.length);
    expect(stats?.firstDay).toBe(days[0]);
    for (const day of days) {
      const onDay = log.filter((entry) => entry.day === day);
      expect(tallies.get(day)?.value).toMatchObject({
        answers: onDay.length,
        firstPass: onDay.filter((entry) => entry.detail.pass === "first").length,
      });
    }
  });
});

/** Stores whose next `losses` commits each lose a race to another write of the stats. */
function racing(inner: LearnerStores, losses: number): LearnerStores {
  let left = losses;
  return {
    forLearner(id) {
      const store = inner.forLearner(id);
      const raced: LearnerStore = {
        ...store,
        async commit(commit) {
          if (left > 0) {
            left -= 1;
            const stats = await store.stats();
            if (stats !== undefined) {
              await store.commit({
                puts: [],
                updates: [
                  {
                    entry: { type: "stats", value: stats.value },
                    version: stats.version,
                  },
                ],
                expect: [],
              });
            }
          }
          return store.commit(commit);
        },
      };
      return raced;
    },
  };
}

describe("a command that loses a race", () => {
  async function ready(): Promise<Harness> {
    const h = makeHarness();
    await updateSettings(h.deps, h.context(), { topics: ["work"] });
    const started = await startRound(h.deps, h.context(), {
      kind: "placement",
      roundId: "p1",
    });
    if (!started.ok) throw new Error(started.error.code);
    return h;
  }

  it("loads, decides and commits again", async () => {
    const h = await ready();
    const deps = { ...h.deps, stores: racing(h.stores, 2) };
    const round = await h.stores.forLearner(h.learner).round("p1");

    const recorded = await recordAnswers(deps, h.context(), {
      roundId: "p1",
      answers: (round?.value.deck ?? []).slice(0, 3).map((cardId) => ({
        id: `p1:f:${cardId}`,
        roundId: "p1",
        cardId,
        pass: "first" as const,
        result: "ok" as const,
        elapsedMs: 1_000,
      })),
    });

    expect(recorded.ok).toBe(true);
    expect(await h.stores.forLearner(h.learner).reviewsOf("p1")).toHaveLength(3);
  });

  it("answers ERR_CONFLICT once it has lost every attempt", async () => {
    const h = await ready();
    const deps = { ...h.deps, stores: racing(h.stores, 10) };

    expect(
      await startRound(deps, h.context(), { kind: "extra", roundId: "e1" }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
  });
});
