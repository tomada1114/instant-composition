import { describe, expect, it } from "vitest";

import {
  countWords,
  estimateMinutes,
  isFast,
  limitMsOf,
  limitSecondsOf,
  paceMsForWords,
  paceMsOf,
  paceOf,
  paceSecondsForWords,
  TUNING,
} from "@instant-composition/domain";

describe("the time limit", () => {
  it("offers 15, 20, 30, 45 and 60 seconds, and gives 30 to a learner who never chose", () => {
    expect(TUNING.limitSeconds).toStrictEqual([15, 20, 30, 45, 60]);
    expect(limitSecondsOf(undefined)).toBe(30);
    expect(
      limitSecondsOf({ topics: ["work"], focus: [], dailySize: 10, sound: true }),
    ).toBe(30);
  });

  it("is the one the learner chose", () => {
    expect(
      limitSecondsOf({
        topics: ["work"],
        focus: [],
        dailySize: 10,
        sound: true,
        limitSeconds: 45,
      }),
    ).toBe(45);
  });

  it("is the one a round was dealt with, or each card's pace for a round dealt before it was a setting", () => {
    expect(limitMsOf({ limitMs: 30_000 }, 8_000)).toBe(30_000);
    expect(limitMsOf({}, 8_000)).toBe(8_000);
  });
});

describe("a card's pace", () => {
  it.each([
    [1, 6],
    [4, 6],
    [6, 7],
    [12, 10],
    [20, 14],
    [28, 18],
    [40, 20],
  ])("gives a %p-word answer %p seconds", (words, seconds) => {
    expect(paceSecondsForWords(words)).toBe(seconds);
  });

  it("states the pace in milliseconds", () => {
    expect(paceMsForWords(12)).toBe(10_000);
  });

  it("is the shortest for a deleted card, whose length is gone", () => {
    expect(paceMsOf(null)).toBe(6_000);
    expect(paceMsOf(12)).toBe(10_000);
  });

  it("counts words the way levels.json does, by whitespace", () => {
    expect(countWords("Can we push the meeting to next week?")).toBe(8);
    expect(countWords("  I'll   send it.  ")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords("Wait — send it.")).toBe(3);
  });
});

describe("a fast answer", () => {
  it("is one flipped within half the pace", () => {
    expect(isFast(5_000, 10_000)).toBe(true);
    expect(isFast(5_001, 10_000)).toBe(false);
  });

  it.each([15, 20, 30, 45, 60])(
    "follows the length-derived pace, not a %i-second limit",
    (seconds) => {
      const answer = { limitMs: seconds * 1000, paceMs: 8_000 };
      expect(isFast(4_000, paceOf(answer))).toBe(true);
      expect(isFast(4_001, paceOf(answer))).toBe(false);
    },
  );

  it("takes the limit as the pace for an answer logged before the limit was a setting", () => {
    expect(paceOf({ limitMs: 8_000 })).toBe(8_000);
  });
});

describe("the estimate on the start screen", () => {
  it.each([
    [5, 3],
    [10, 5],
    [15, 8],
    [20, 10],
    [30, 15],
    [7, 4],
  ])("puts %p cards at the default limit at about %p minutes", (cards, minutes) => {
    expect(estimateMinutes(cards, TUNING.defaultLimitSeconds)).toBe(minutes);
  });

  it.each([
    [15, 3],
    [20, 4],
    [30, 5],
    [45, 8],
    [60, 10],
  ] as const)(
    "puts ten cards at a %p-second limit at about %p minutes",
    (limit, minutes) => {
      expect(estimateMinutes(10, limit)).toBe(minutes);
    },
  );
});
