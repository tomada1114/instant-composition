import { describe, expect, it } from "vitest";
import { vocabFreshPosition } from "@instant-composition/domain";

describe("safe global fresh positions", () => {
  it.each([
    [0, 5, 2, 2],
    [1, 5, 2, 6],
    [0, 0, 1, 0],
    [0, 0, 200, 0],
    [199, 0, 200, 199],
    [199, Number.MAX_SAFE_INTEGER - 199, 200, Number.MAX_SAFE_INTEGER],
    [0, Number.MAX_SAFE_INTEGER - 1, 2, 4503599627370495],
  ])(
    "places index %s amongst %s due and %s fresh cards at %s",
    (index, due, fresh, expected) => {
      expect(vocabFreshPosition(index, due, fresh)).toBe(expected);
    },
  );
  it.each([
    [-1, 1, 1],
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 201],
    [0, 1.5, 1],
    [0, Number.MAX_SAFE_INTEGER + 1, 1],
    [199, Number.MAX_SAFE_INTEGER, 200],
  ])("refuses unsafe counters %s/%s/%s", (index, due, fresh) => {
    expect(() => vocabFreshPosition(index, due, fresh)).toThrow(RangeError);
  });
});
