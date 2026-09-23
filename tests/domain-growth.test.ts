import { describe, expect, it } from "vitest";

import {
  reviewList,
  roundGrowth,
  roundPoints,
  totals,
} from "@instant-composition/domain";
import { makeAnswer } from "./domain-fixtures";

const before = { roundId: "old", day: "2026-09-20" };
const now = { roundId: "r", day: "2026-09-22" };

describe("today's growth", () => {
  it("counts a correct answer at least 100 ms faster than last time", () => {
    const growth = roundGrowth({
      roundId: "r",
      existing: new Set(["c1", "c2"]),
      answers: [
        makeAnswer({ ...before, cardId: "c1", elapsedMs: 4_000, answeredAt: 1 }),
        makeAnswer({ ...before, cardId: "c2", elapsedMs: 4_000, answeredAt: 2 }),
        makeAnswer({
          ...now,
          cardId: "c1",
          elapsedMs: 2_800,
          answeredAt: 10,
          ja: "一",
        }),
        makeAnswer({ ...now, cardId: "c2", elapsedMs: 3_901, answeredAt: 11 }),
      ],
    });
    expect(growth).toMatchObject({ faster: 1, fixed: 0, compared: 2, firstTime: 0 });
    expect(growth.rows).toStrictEqual([
      { cardId: "c1", ja: "一", kind: "faster", deltaMs: 1_200 },
    ]);
  });

  it("counts a miss last time that is correct now", () => {
    const growth = roundGrowth({
      roundId: "r",
      existing: new Set(["c1"]),
      answers: [
        makeAnswer({
          ...before,
          cardId: "c1",
          result: "timeout",
          elapsedMs: 10_000,
          answeredAt: 1,
        }),
        makeAnswer({ ...now, cardId: "c1", elapsedMs: 6_000, answeredAt: 10 }),
      ],
    });
    expect(growth).toMatchObject({ faster: 0, fixed: 1, compared: 1 });
    expect(growth.rows[0]).toMatchObject({ kind: "fixed", deltaMs: 4_000 });
  });

  it("compares with the latest earlier first pass, never a retry or this round", () => {
    const growth = roundGrowth({
      roundId: "r",
      existing: new Set(["c1"]),
      answers: [
        makeAnswer({ ...before, cardId: "c1", elapsedMs: 9_000, answeredAt: 1 }),
        makeAnswer({ ...before, cardId: "c1", elapsedMs: 3_000, answeredAt: 2 }),
        makeAnswer({
          ...before,
          cardId: "c1",
          pass: "retry",
          elapsedMs: 9_000,
          answeredAt: 3,
        }),
        makeAnswer({ ...now, cardId: "c1", elapsedMs: 5_000, answeredAt: 10 }),
        makeAnswer({
          ...now,
          cardId: "c1",
          pass: "retry",
          elapsedMs: 1_000,
          answeredAt: 11,
        }),
      ],
    });
    expect(growth).toMatchObject({ faster: 0, compared: 1 });
  });

  it("counts cards with nothing to compare against as first-timers", () => {
    const growth = roundGrowth({
      roundId: "r",
      existing: new Set(["c1", "c2"]),
      answers: [
        makeAnswer({ ...now, cardId: "c1", answeredAt: 10 }),
        makeAnswer({ ...now, cardId: "c2", answeredAt: 11 }),
      ],
    });
    expect(growth).toMatchObject({ compared: 0, firstTime: 2, rows: [] });
  });

  it("leaves out a card that no longer exists", () => {
    const growth = roundGrowth({
      roundId: "r",
      existing: new Set(),
      answers: [
        makeAnswer({ ...before, cardId: "c1", elapsedMs: 9_000, answeredAt: 1 }),
        makeAnswer({ ...now, cardId: "c1", elapsedMs: 1_000, answeredAt: 10 }),
      ],
    });
    expect(growth).toMatchObject({ faster: 0, compared: 0, firstTime: 0 });
  });

  it("lists the biggest differences first", () => {
    const growth = roundGrowth({
      roundId: "r",
      existing: new Set(["a", "b", "c"]),
      answers: [
        makeAnswer({ ...before, cardId: "a", elapsedMs: 5_000, answeredAt: 1 }),
        makeAnswer({ ...before, cardId: "b", elapsedMs: 5_000, answeredAt: 2 }),
        makeAnswer({
          ...before,
          cardId: "c",
          result: "ng",
          elapsedMs: 6_000,
          answeredAt: 3,
        }),
        makeAnswer({ ...now, cardId: "a", elapsedMs: 4_400, answeredAt: 10 }),
        makeAnswer({ ...now, cardId: "b", elapsedMs: 3_800, answeredAt: 11 }),
        makeAnswer({ ...now, cardId: "c", elapsedMs: 5_000, answeredAt: 12 }),
      ],
    });
    expect(growth.rows.map((row) => row.cardId)).toStrictEqual(["b", "c", "a"]);
  });
});

describe("cards sent to review", () => {
  it("are this round's first-pass misses in the order shown, retried ones included", () => {
    const list = reviewList("r", [
      makeAnswer({ ...now, cardId: "a", result: "ng", answeredAt: 2, ja: "あ" }),
      makeAnswer({ ...now, cardId: "b", answeredAt: 1 }),
      makeAnswer({ ...now, cardId: "c", result: "timeout", answeredAt: 3, ja: "う" }),
      makeAnswer({ ...now, cardId: "a", pass: "retry", answeredAt: 4 }),
      makeAnswer({ ...before, cardId: "d", result: "ng", answeredAt: 0 }),
    ]);
    expect(list).toStrictEqual([
      { cardId: "a", ja: "あ" },
      { cardId: "c", ja: "う" },
    ]);
  });
});

describe("points", () => {
  it("gives a point a card, plus ten when the round completes a portion", () => {
    expect(roundPoints(10, true)).toBe(20);
    expect(roundPoints(10, false)).toBe(10);
    expect(roundPoints(7, true)).toBe(17);
  });
});

describe("running totals", () => {
  it("count every answer, every practice day and the last fourteen days", () => {
    const result = totals(
      [
        makeAnswer({ day: "2026-09-22" }),
        makeAnswer({ day: "2026-09-22", pass: "retry" }),
        makeAnswer({ day: "2026-09-10" }),
        makeAnswer({ day: "2026-09-01" }),
      ],
      "2026-09-22",
    );
    expect(result.said).toBe(4);
    expect(result.practicedDays).toBe(3);
    expect(result.last14).toHaveLength(14);
    expect(result.last14[0]).toStrictEqual({ day: "2026-09-09", count: 0 });
    expect(result.last14[1]).toStrictEqual({ day: "2026-09-10", count: 1 });
    expect(result.last14[13]).toStrictEqual({ day: "2026-09-22", count: 2 });
  });
});
