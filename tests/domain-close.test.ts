import { describe, expect, it } from "vitest";

import {
  decideClose,
  type CloseState,
  type DifficultyAnswer,
  type ItemProgress,
  type ReviewEntry,
} from "@instant-composition/domain";

import {
  makeDay,
  makeItem,
  makePortion,
  makeReview,
  makeRound,
  makeStats,
} from "./application-fixtures";

const LEVEL_5 = { level: 5, reason: "placement" as const, roundId: "p0", at: 0 };

function first(
  cardId: string,
  result: "ok" | "ng",
  elapsedMs = 3_000,
  level = 5,
): ReviewEntry {
  return makeReview({
    id: `r1:f:${cardId}`,
    item: { kind: "composition", id: cardId },
    snapshot: { topic: "work", subtopic: "meetings", level, prompt: `${cardId}の文` },
    detail: {
      activity: "composition",
      pass: "first",
      result,
      elapsedMs,
      limitMs: 8_000,
    },
  });
}

function state(overrides: Partial<CloseState> = {}): CloseState {
  return {
    round: makeRound({ deck: ["c1", "c2", "c3"], firstPass: 3 }),
    stats: makeStats({ level: LEVEL_5, openRound: { id: "r1", day: "2026-09-22" } }),
    portion: makePortion({ target: 3, progress: 3 }),
    day: makeDay({ answers: 3, firstPass: 3 }),
    items: new Map(),
    reviews: [first("c1", "ok"), first("c2", "ok"), first("c3", "ok")],
    tallies: new Map([["2026-09-22", makeDay({ answers: 3 })]]),
    catalog: {
      topicOrder: ["work", "travel"],
      chosen: ["work"],
      shown: new Set(["c1", "c2", "c3"]),
      placeOf: () => undefined,
    },
    ...overrides,
  };
}

describe("decideClose", () => {
  it("completes the portion this round took to its target, once", () => {
    const closed = decideClose(state(), 50);
    const again = decideClose(
      state({ portion: makePortion({ target: 3, progress: 3, completedAt: 9 }) }),
      50,
    );
    const short = decideClose(
      state({ portion: makePortion({ target: 4, progress: 3 }) }),
      50,
    );

    expect(closed.portion).toMatchObject({ completedAt: 50, completedRound: "r1" });
    expect(closed.stats.completedDays).toStrictEqual(["2026-09-22"]);
    expect(closed.outcome).toMatchObject({
      portionCompleted: true,
      filled: "2026-09-22",
    });
    expect(again.portion).toBeUndefined();
    expect(short.portion).toBeUndefined();
    expect(short.outcome.filled).toBeNull();
  });

  it("earns a point per first pass, and the bonus with a completed portion", () => {
    const closed = decideClose(
      state({ stats: makeStats({ points: 7, level: LEVEL_5 }) }),
      50,
    );
    expect(closed.outcome.points).toStrictEqual({ earned: 13, total: 20 });
    expect(closed.stats.points).toBe(20);
  });

  it("finishes the round, clears it as the open one, and counts it on its day", () => {
    const closed = decideClose(state(), 50);
    expect(closed.round).toMatchObject({ finishedAt: 50, outcome: closed.outcome });
    expect(closed.stats.openRound).toBeNull();
    expect(closed.day).toMatchObject({ roundsFinished: 1, lastFinishedRound: "r1" });
    expect(decideClose(state({ day: undefined }), 50).day).toMatchObject({
      answers: 0,
      roundsFinished: 1,
    });
  });

  it("leaves another round open", () => {
    const stats = makeStats({
      level: LEVEL_5,
      openRound: { id: "r2", day: "2026-09-22" },
    });
    expect(decideClose(state({ stats }), 50).stats.openRound).toStrictEqual({
      id: "r2",
      day: "2026-09-22",
    });
  });

  it("sets the level a placement measured, and says whether it was the first", () => {
    const round = makeRound({
      kind: "placement",
      deck: ["c1", "c2", "c3"],
      firstPass: 3,
    });
    const reviews = [
      first("c1", "ok", 1_000, 2),
      first("c2", "ok", 1_000, 4),
      first("c3", "ng", 1_000, 6),
    ];
    const placed = decideClose(state({ round, reviews, stats: makeStats() }), 50);
    const again = decideClose(state({ round, reviews }), 50);

    expect(placed.outcome.placement).toStrictEqual({ level: 4, first: true });
    expect(placed.stats.level).toStrictEqual({
      level: 4,
      reason: "placement",
      roundId: "r1",
      at: 50,
    });
    expect(again.outcome.placement).toStrictEqual({ level: 4, first: false });
  });

  it("moves the level up after a window of fast correct answers, and starts the window over", () => {
    const window: DifficultyAnswer[] = Array.from({ length: 20 }, (_, index) => ({
      level: 5,
      result: "ok",
      elapsedMs: 1_000,
      limitMs: 8_000,
      answeredAt: index,
    }));
    const closed = decideClose(
      state({ stats: makeStats({ level: LEVEL_5, levelWindow: window }) }),
      50,
    );

    expect(closed.outcome.difficulty).toStrictEqual({ change: "up", level: 6 });
    expect(closed.stats.level).toMatchObject({ level: 6, reason: "up" });
    expect(closed.stats.levelWindow).toStrictEqual([]);
  });

  it("keeps the level and its window when the window says nothing yet", () => {
    const levelWindow = [
      { level: 5, result: "ok" as const, elapsedMs: 1, limitMs: 8_000, answeredAt: 1 },
    ];
    const closed = decideClose(
      state({ stats: makeStats({ level: LEVEL_5, levelWindow }) }),
      50,
    );
    expect(closed.outcome.difficulty).toBeNull();
    expect(closed.stats.levelWindow).toStrictEqual(levelWindow);
    expect(
      decideClose(state({ stats: makeStats() }), 50).outcome.difficulty,
    ).toBeNull();
  });

  it("lists this round's first-pass misses in the order they were shown", () => {
    const round = makeRound({ deck: ["c3", "c1", "c2"], firstPass: 3 });
    const reviews = [first("c1", "ng"), first("c2", "ok"), first("c3", "ng")];
    expect(decideClose(state({ round, reviews }), 50).outcome.review).toStrictEqual([
      { cardId: "c3", ja: "c3の文" },
      { cardId: "c1", ja: "c1の文" },
    ]);
  });

  it("compares each first pass with the item's previous one from an earlier round", () => {
    const item = (
      id: string,
      previous: ItemProgress["previous"],
    ): [string, ItemProgress] => [
      id,
      makeItem({
        item: { kind: "composition", id },
        last: { sessionId: "r1", result: "ok", elapsedMs: 3_000, answeredAt: 10 },
        previous,
      }),
    ];
    const items = new Map([
      item("c1", { sessionId: "r0", result: "ok", elapsedMs: 5_000, answeredAt: 1 }),
      item("c2", { sessionId: "r0", result: "ng", elapsedMs: 5_000, answeredAt: 1 }),
      item("c3", null),
    ]);
    expect(decideClose(state({ items }), 50).outcome.growth).toStrictEqual({
      faster: 1,
      fixed: 1,
      compared: 2,
      firstTime: 1,
      rows: [
        { cardId: "c1", ja: "c1の文", deltaMs: 2_000, kind: "faster" },
        { cardId: "c2", ja: "c2の文", deltaMs: 2_000, kind: "fixed" },
      ],
    });
  });

  it("counts mastered items per chosen topic, and titles the milestones crossed", () => {
    const mastered = (id: string, sessionId: string): [string, ItemProgress] => [
      id,
      makeItem({
        item: { kind: "composition", id },
        mastered: { day: "2026-09-22", sessionId },
      }),
    ];
    const items = new Map([
      ...Array.from({ length: 9 }, (_, index) => mastered(`old${String(index)}`, "r0")),
      mastered("c1", "r1"),
    ]);
    const closed = decideClose(state({ items }), 50);

    expect(closed.outcome.reach).toStrictEqual([
      { topic: "work", count: 10, added: 1 },
    ]);
    expect(closed.outcome.titles).toStrictEqual(["reach:work:10"]);
    expect(closed.stats.titles).toStrictEqual(["reach:work:10"]);
  });

  it("totals the fourteen days ending with the round's day", () => {
    const tallies = new Map([
      ["2026-09-22", makeDay({ answers: 3 })],
      ["2026-09-09", makeDay({ day: "2026-09-09", answers: 4 })],
      ["2026-09-08", makeDay({ day: "2026-09-08", answers: 9 })],
    ]);
    const { totals } = decideClose(state({ tallies }), 50).outcome;
    expect(totals.last14[0]).toStrictEqual({ day: "2026-09-09", count: 4 });
    expect(totals.last14[13]).toStrictEqual({ day: "2026-09-22", count: 3 });
    expect(totals.added).toBe(3);
  });

  it("sends a learner who made up yesterday back to today, and one who placed on to the rest", () => {
    const yesterday = makeRound({
      kind: "yesterday",
      portionDay: "2026-09-21",
      firstPass: 3,
    });
    const placement = makeRound({ kind: "placement", firstPass: 3 });
    expect(
      decideClose(state({ round: yesterday, portion: undefined }), 50).outcome
        .todayOpen,
    ).toBe(true);
    expect(
      decideClose(
        state({ round: placement, portion: makePortion({ target: 10, progress: 3 }) }),
        50,
      ).outcome.continueToday,
    ).toBe(true);
  });
});
