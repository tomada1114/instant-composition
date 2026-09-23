import { afterEach, describe, expect, it } from "vitest";

import type { RoundKind } from "../src/core/types";
import type { RoundPayload, RoundSummary } from "../src/core/views";
import type { AnswerInput } from "../src/core/api";
import { removeContentRoots } from "./cards-fixture";
import {
  firstPassAnswers,
  makeHarness,
  retryAnswers,
  type Harness,
} from "./services-harness";

const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
  removeContentRoots();
});

function setUp(dailySize: 5 | 10 | 20 = 10): Harness {
  const harness = makeHarness();
  harnesses.push(harness);
  harness.services.updateSettings({ topics: ["work", "daily"], dailySize });
  return harness;
}

function start(harness: Harness, kind: RoundKind): RoundPayload {
  const result = harness.services.startRound(kind);
  if (!result.ok) throw new Error(`expected a round, got ${result.error.code}`);
  return result.value;
}

function finish(
  harness: Harness,
  round: RoundPayload,
  answers: AnswerInput[],
): RoundSummary {
  const result = harness.services.finishRound(round.id, answers);
  if (!result.ok) throw new Error(`expected a summary, got ${result.error.code}`);
  return result.value;
}

/** Placement with the first `solid` cards answered fast and the rest missed. */
function place(harness: Harness, solid = 10): RoundSummary {
  const round = start(harness, "placement");
  const results = round.deck.map((_, index) => (index < solid ? "ok" : "ng"));
  return finish(harness, round, firstPassAnswers(round, results));
}

describe("finishing the first placement round", () => {
  it("sets the level, completes today and counts the first day", () => {
    const summary = place(setUp());
    expect(summary).toMatchObject({
      kind: "placement",
      day: "2026-09-23",
      yesterday: false,
      placement: { level: 10, toeic: "0", first: true },
      portionCompleted: true,
      continueToday: false,
      streak: { value: 1, restart: false, changed: true },
      filled: "2026-09-23",
      points: { earned: 20, total: 20 },
      titles: [],
      review: [],
      difficulty: null,
    });
    expect(summary.growth).toMatchObject({ firstTime: 10, compared: 0 });
    expect(summary.totals).toMatchObject({ said: 10, practicedDays: 1, added: 10 });
    expect(summary.week.find((dot) => dot.day === "2026-09-23")?.state).toBe("done");
  });

  it("sets the level of the k-th card for k solid answers and lists the misses", () => {
    const harness = setUp();
    const summary = place(harness, 3);
    expect(summary.placement?.level).toBe(3);
    expect(summary.review).toHaveLength(7);
    expect(harness.store.currentLevel()).toMatchObject({
      level: 3,
      reason: "placement",
    });
  });

  it("answers the same summary when finished again", () => {
    const harness = setUp();
    const round = start(harness, "placement");
    const answers = firstPassAnswers(round);
    const first = finish(harness, round, answers);
    expect(finish(harness, round, answers)).toStrictEqual(first);
    expect(harness.services.recap()).toStrictEqual(first);
  });

  it("leaves the rest of a larger portion to go on with", () => {
    const harness = setUp(20);
    const summary = place(harness);
    expect(summary).toMatchObject({ portionCompleted: false, continueToday: true });
    expect(summary.streak.changed).toBe(false);
    expect(harness.services.home().state).toMatchObject({
      kind: "in-progress",
      progress: 10,
      target: 20,
      resumeKind: "today",
    });
    expect(start(harness, "today")).toMatchObject({ offset: 10, total: 20 });
  });
});

describe("finishing a later round", () => {
  it("does not move the streak for an extra round, and gives a point a card", () => {
    const harness = setUp();
    place(harness);
    const extra = start(harness, "extra");
    const summary = finish(harness, extra, firstPassAnswers(extra));
    expect(summary).toMatchObject({
      portionCompleted: false,
      filled: null,
      streak: { value: 1, changed: false },
      points: { earned: 10, total: 30 },
    });
  });

  it("counts only first-pass answers toward the portion", () => {
    const harness = setUp();
    place(harness);
    harness.setTime(2026, 9, 24, 9);
    const round = start(harness, "today");
    const first = firstPassAnswers(round, ["ng", "timeout"]);
    const summary = finish(harness, round, [...first, ...retryAnswers(round, first)]);
    expect(summary.portionCompleted).toBe(true);
    expect(summary.review.map((row) => row.cardId)).toStrictEqual(
      round.deck.slice(0, 2),
    );
    expect(summary.totals.added).toBe(12);
    expect(summary.streak).toMatchObject({ value: 2, changed: true });
  });

  it("raises the level once twenty answers in the band are right and fast", () => {
    const harness = setUp();
    place(harness, 3);
    const one = start(harness, "extra");
    expect(
      finish(harness, one, firstPassAnswers(one, [], 1_000)).difficulty,
    ).toBeNull();
    const two = start(harness, "extra");
    expect(
      finish(harness, two, firstPassAnswers(two, [], 1_000)).difficulty,
    ).toStrictEqual({
      change: "up",
      toeic: "0",
    });
    expect(harness.store.currentLevel()?.level).toBe(4);
  });

  it("counts cards right on a second day as mastered", () => {
    const harness = setUp();
    place(harness);
    harness.setTime(2026, 9, 27, 9);
    const round = start(harness, "today");
    const summary = finish(harness, round, firstPassAnswers(round));
    const added = summary.reach.topics.reduce((sum, topic) => sum + topic.added, 0);
    expect(added).toBe(6);
    expect(summary.growth.compared).toBe(6);
  });

  it("awards the seven-day title once", () => {
    const harness = setUp();
    for (const day of ["17", "18", "19", "20", "21", "22"]) {
      harness.store.insertPortion(`2026-09-${day}`, 10);
      harness.store.completePortion(`2026-09-${day}`, 1, "seed");
    }
    const summary = place(harness);
    expect(summary.titles).toStrictEqual(["streak:7"]);
    expect(summary.streak.value).toBe(7);
    const extra = start(harness, "extra");
    expect(finish(harness, extra, firstPassAnswers(extra)).titles).toStrictEqual([]);
  });
});

describe("changing the daily size", () => {
  it("completes today at once when enough is already done", () => {
    const harness = setUp();
    place(harness);
    harness.setTime(2026, 9, 24, 9);
    const round = start(harness, "today");
    for (const answer of firstPassAnswers(round).slice(0, 5)) {
      harness.services.recordAnswer(answer);
    }
    const changed = harness.services.updateSettings({ dailySize: 5 });
    expect(changed).toMatchObject({ ok: true, value: { completedToday: true } });
    expect(harness.services.home().state.kind).toBe("done");
    expect(harness.store.getRound(round.id)?.finishedAt).not.toBeNull();
  });

  it("stretches the open round's deck when the size goes up", () => {
    const harness = setUp();
    place(harness);
    harness.setTime(2026, 9, 24, 9);
    const round = start(harness, "today");
    harness.services.updateSettings({ dailySize: 15 });
    expect(harness.store.getPortion("2026-09-24")?.target).toBe(15);
    expect(start(harness, "today")).toMatchObject({ id: round.id, total: 15 });
    expect(harness.store.getRound(round.id)?.deck).toHaveLength(15);
  });
});
