import { describe, expect, it } from "vitest";

import {
  calendarDots,
  longestRun,
  runEndingAt,
  streakStatus,
  weekDots,
} from "@instant-composition/domain";

const T = "2026-09-23"; // a Wednesday

/** `n` consecutive completed days ending at `last`. */
function days(last: string, n: number): string[] {
  const end = new Date(`${last}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, index) =>
    new Date(end - index * 86_400_000).toISOString().slice(0, 10),
  );
}

describe("runs of completed days", () => {
  it("counts back from a day while each day is completed", () => {
    expect(runEndingAt(new Set(days("2026-09-22", 12)), "2026-09-22")).toBe(12);
    expect(runEndingAt(new Set(days("2026-09-22", 12)), T)).toBe(0);
  });

  it("finds the longest run anywhere", () => {
    const completed = new Set([...days("2026-08-31", 21), ...days("2026-09-20", 3)]);
    expect(longestRun(completed)).toBe(21);
    expect(longestRun(new Set())).toBe(0);
  });
});

describe("the streak on a given day", () => {
  it("counts today once today's portion is done", () => {
    expect(streakStatus(new Set(days(T, 13)), T)).toStrictEqual({
      kind: "done",
      current: 13,
      restoresTo: null,
    });
  });

  it("offers to restore yesterday on a restarted day that is done", () => {
    const completed = new Set([T, ...days("2026-09-21", 12)]);
    expect(streakStatus(completed, T)).toStrictEqual({
      kind: "done",
      current: 1,
      restoresTo: 14,
    });
  });

  it("carries yesterday's run while today is still open", () => {
    expect(streakStatus(new Set(days("2026-09-22", 12)), T)).toStrictEqual({
      kind: "alive",
      current: 12,
    });
  });

  it("holds the run to the day before yesterday when only yesterday is open", () => {
    expect(streakStatus(new Set(days("2026-09-21", 12)), T)).toStrictEqual({
      kind: "gap",
      current: 12,
    });
  });

  it("is broken after two open days, keeping the longest", () => {
    expect(streakStatus(new Set(days("2026-09-20", 21)), T)).toStrictEqual({
      kind: "broken",
      longest: 21,
    });
  });

  it("is broken with nothing behind it on the first day", () => {
    expect(streakStatus(new Set(), T)).toStrictEqual({ kind: "broken", longest: 0 });
  });
});

describe("the dots of the week", () => {
  it("marks done days, today and the days after it as upcoming", () => {
    const completed = new Set(days("2026-09-22", 5));
    expect(weekDots(completed, T, "2026-09-01").map((dot) => dot.state)).toStrictEqual([
      "done",
      "done",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("marks a recoverable yesterday as a gap and older open days as missed", () => {
    const completed = new Set(["2026-09-21"]);
    const week = weekDots(completed, "2026-09-24", "2026-09-01");
    expect(week.map((dot) => dot.state)).toStrictEqual([
      "done",
      "missed",
      "missed",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    const gap = weekDots(new Set(["2026-09-21"]), T, "2026-09-01");
    expect(gap[1]).toStrictEqual({ day: "2026-09-22", state: "gap" });
  });

  it("leaves days before the first use as upcoming", () => {
    const week = weekDots(new Set([T]), T, T);
    expect(week.map((dot) => dot.state)).toStrictEqual([
      "upcoming",
      "upcoming",
      "done",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("lays out twelve weeks for the calendar with the same states", () => {
    const calendar = calendarDots(new Set([T]), T, T);
    expect(calendar).toHaveLength(12);
    expect(calendar[11]?.[2]).toStrictEqual({ day: T, state: "done" });
    expect(calendar[0]?.[0]?.state).toBe("upcoming");
  });
});
