import { describe, expect, it } from "vitest";

import {
  finishRound,
  recordAnswers,
  startRound,
  updateSettings,
  type LearnerStore,
  type LearnerStores,
} from "@instant-composition/application";
import {
  deriveCardStates,
  masteredCards,
  replayItems,
  type AnswerRecord,
  type ReviewEntry,
} from "@instant-composition/domain";

import {
  answersFor,
  DAY_MS,
  makeHarness,
  NOON,
  type Harness,
} from "./application-harness";

/** The log entry in the shape the replaying rules of `packages/domain` read. */
function asAnswer(entry: ReviewEntry): AnswerRecord {
  return {
    id: entry.id,
    roundId: entry.sessionId,
    cardId: entry.item.id,
    pass: entry.detail.pass,
    result: entry.detail.result,
    elapsedMs: entry.detail.elapsedMs,
    limitMs: entry.detail.limitMs,
    day: entry.day,
    answeredAt: entry.answeredAt,
    topic: entry.snapshot.topic,
    subtopic: entry.snapshot.subtopic,
    level: entry.snapshot.level,
    prompt: entry.snapshot.prompt,
  };
}

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

describe("the projections a command keeps", () => {
  it("equal what replaying the review log rebuilds", async () => {
    const h = makeHarness();
    await fiveDays(h);
    const store = h.stores.forLearner(h.learner);
    const log = await store.reviews();
    const items = new Map(
      [...(await store.items())].map(([id, stored]) => [id, stored.value]),
    );

    expect(log.length).toBeGreaterThan(50);
    expect(items).toStrictEqual(replayItems(log));
  });

  it("agree with the rules that replay the whole answer log", async () => {
    const h = makeHarness();
    await fiveDays(h);
    const store = h.stores.forLearner(h.learner);
    const answers = (await store.reviews()).map(asAnswer);
    const items = await store.items();

    const memory = new Map([...items].map(([id, stored]) => [id, stored.value.memory]));
    const mastered = new Map(
      [...items].flatMap(([id, stored]) =>
        stored.value.mastered === null
          ? []
          : [
              [
                id,
                {
                  cardId: id,
                  day: stored.value.mastered.day,
                  roundId: stored.value.mastered.sessionId,
                },
              ] as const,
            ],
      ),
    );

    expect(memory).toStrictEqual(deriveCardStates(answers));
    expect(mastered.size).toBeGreaterThan(0);
    expect(mastered).toStrictEqual(masteredCards(answers));
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
