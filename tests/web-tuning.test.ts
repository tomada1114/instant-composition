import { describe, expect, it } from "vitest";

import { TUNING as DOMAIN_TUNING } from "@instant-composition/domain";
import { isFast, parseTitleKey, TUNING } from "@instant-composition/web";

// The web client imports no workspace package, so the rule values it shows or
// applies are copies; this is what keeps each copy equal to its source.

describe("the web client's tuning", () => {
  it("holds the practice rules' day boundary and fast share as the domain states them", () => {
    expect(TUNING.dayBoundaryHour).toBe(DOMAIN_TUNING.dayBoundaryHour);
    expect(TUNING.fastRatio).toBe(DOMAIN_TUNING.fastRatio);
  });

  it("offers the domain's daily sizes and keeps its most focus subtopics", () => {
    expect(TUNING.dailySizes).toStrictEqual(DOMAIN_TUNING.dailySizes);
    expect(TUNING.maxFocus).toBe(DOMAIN_TUNING.maxFocus);
  });

  it("calls a flip fast up to half the limit, and not past it", () => {
    expect(isFast(5_000, 10_000)).toBe(true);
    expect(isFast(5_001, 10_000)).toBe(false);
  });
});

describe("parseTitleKey", () => {
  it.each([
    ["streak:30", { kind: "streak", value: 30 }],
    ["reach:work:100", { kind: "reach", topic: "work", value: 100 }],
  ] as const)("reads %s", (key, title) => {
    expect(parseTitleKey(key)).toStrictEqual(title);
  });

  it.each(["streak:", "streak:x", "reach:work", "reach::5", "grade:1", ""])(
    "leaves out %j, a key this client does not know",
    (key) => {
      expect(parseTitleKey(key)).toBeUndefined();
    },
  );
});
