import { describe, expect, it } from "vitest";

import {
  gradedOf,
  gradeOf,
  intervalsOf,
  movesItem,
  resultOf,
  scheduleCard,
  type FsrsGrade,
  type ItemProgress,
} from "@instant-composition/domain";

import { FIRST_GOOD, makeItem, makeLeitnerReview } from "./application-fixtures";

// The drill's card on FSRS: what an answer's grade is, what the figures count
// it as, which answers move the schedule, and the intervals a card is dealt
// with. A new card's first grade gives 1, 2 and 3 days under the default weights.

describe("an answer's grade", () => {
  it.each([
    ["ok", "good", false],
    ["ng", "again", false],
    ["timeout", "again", true],
  ] as const)(
    "takes an older client's %s as %s, timed out: %s",
    (result, grade, timedOut) => {
      expect(gradedOf({ result })).toStrictEqual({ grade, timedOut });
    },
  );

  it("takes a grade as given, not timed out unless it says so, over any result", () => {
    expect(gradedOf({ grade: "hard" })).toStrictEqual({
      grade: "hard",
      timedOut: false,
    });
    expect(gradedOf({ grade: "hard", timedOut: true, result: "ok" })).toStrictEqual({
      grade: "hard",
      timedOut: true,
    });
  });

  it("finds none in an answer carrying neither", () => {
    expect(gradedOf({})).toBeUndefined();
  });

  it("reads a review logged before three grades from its result", () => {
    const leitner = makeLeitnerReview();
    expect(gradeOf(leitner.detail)).toStrictEqual({ grade: "good", timedOut: false });
    expect(gradeOf({ ...leitner.detail, result: "timeout" })).toStrictEqual({
      grade: "again",
      timedOut: true,
    });
    expect(
      gradeOf({ ...leitner.detail, result: "timeout", grade: "hard", timedOut: true }),
    ).toStrictEqual({ grade: "hard", timedOut: true });
  });
});

describe("what the figures count an answer as", () => {
  it.each<[FsrsGrade, boolean, string]>([
    ["again", false, "ng"],
    ["hard", false, "ok"],
    ["good", false, "ok"],
    ["again", true, "timeout"],
    ["hard", true, "timeout"],
    ["good", true, "timeout"],
  ])("counts %s, timed out: %s, as %s", (grade, timedOut, result) => {
    expect(resultOf({ grade, timedOut })).toBe(result);
  });
});

describe("which answers move the schedule", () => {
  const moved = makeItem();

  it("moves a new card, and a card seen only under Leitner, on its first pass", () => {
    const { fsrs, ...leitner } = makeItem({
      memory: { box: 3, dueDay: "2026-09-20", lastDay: "2026-09-13", seenCount: 3 },
    });
    expect(fsrs).toBeDefined();
    expect(movesItem(undefined, "first", "2026-09-22")).toBe(true);
    expect(movesItem(leitner, "first", "2026-09-22")).toBe(true);
  });

  it("moves a card on the first pass of a later day", () => {
    expect(movesItem(moved, "first", "2026-09-23")).toBe(true);
  });

  it.each([
    ["a re-ask", "retry", "2026-09-23"],
    ["a later first pass the same day", "first", "2026-09-22"],
    ["a first pass for an earlier day", "first", "2026-09-21"],
  ] as const)("leaves the schedule on %s", (_, pass, day) => {
    expect(movesItem(moved, pass, day)).toBe(false);
  });
});

describe("the intervals a card is dealt with", () => {
  it("gives a new card 1, 2 and 3 days", () => {
    expect(intervalsOf(undefined, "2026-09-22", "c1")).toStrictEqual({
      again: 1,
      hard: 2,
      good: 3,
    });
  });

  it("gives a card in box 3 under Leitner a new card's intervals; graded good, it is due in 3 days", () => {
    const { fsrs, ...rest } = makeItem({
      memory: { box: 3, dueDay: "2026-09-21", lastDay: "2026-09-14", seenCount: 3 },
    });
    const leitner: ItemProgress = rest;
    expect(fsrs).toBeDefined();
    expect(movesItem(leitner, "first", "2026-09-22")).toBe(true);
    expect(intervalsOf(leitner.fsrs, "2026-09-22", "c1")).toStrictEqual({
      again: 1,
      hard: 2,
      good: 3,
    });
    expect(scheduleCard(leitner.fsrs, "good", "2026-09-22", "c1").state.dueDay).toBe(
      "2026-09-25",
    );
  });

  it("gives a card already scheduled the intervals its state and the days since give", () => {
    const intervals = intervalsOf(FIRST_GOOD, "2026-09-25", "c1");
    expect(intervals.again).toBe(1);
    expect(intervals.hard).toBeLessThan(intervals.good);
    expect(intervals.good).toBe(
      scheduleCard(FIRST_GOOD, "good", "2026-09-25", "c1").intervalDays,
    );
  });
});
