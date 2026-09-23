import { describe, expect, it } from "vitest";

import {
  countWords,
  estimateMinutes,
  isFast,
  limitMsForWords,
  limitSecondsForWords,
} from "../src/core/timer";

describe("the time limit", () => {
  it.each([
    [1, 6],
    [4, 6],
    [6, 7],
    [12, 10],
    [20, 14],
    [28, 18],
    [40, 20],
  ])("gives a %p-word answer %p seconds", (words, seconds) => {
    expect(limitSecondsForWords(words)).toBe(seconds);
  });

  it("states the limit in milliseconds for the timer", () => {
    expect(limitMsForWords(12)).toBe(10_000);
  });

  it("counts words the way levels.json does, by whitespace", () => {
    expect(countWords("Can we push the meeting to next week?")).toBe(8);
    expect(countWords("  I'll   send it.  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("a fast answer", () => {
  it("is one flipped within half the limit", () => {
    expect(isFast(5_000, 10_000)).toBe(true);
    expect(isFast(5_001, 10_000)).toBe(false);
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
  ])("puts %p cards at about %p minutes", (cards, minutes) => {
    expect(estimateMinutes(cards)).toBe(minutes);
  });
});
