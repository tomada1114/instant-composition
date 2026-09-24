import { describe, expect, it } from "vitest";

import { countUpPlan, valueAt } from "@instant-composition/web";
import { makeSummary } from "./web-summary-fixture";

describe("countUpPlan", () => {
  it("moves only what this round changed, top to bottom, 150 ms apart", () => {
    const plan = countUpPlan(makeSummary());
    expect(
      plan.map((entry) => [entry.key, entry.from, entry.to, entry.delayMs]),
    ).toStrictEqual([
      ["growth.faster", 0, 3, 0],
      ["growth.fixed", 0, 2, 150],
      ["review", 0, 4, 300],
      ["streak", 12, 13, 450],
      ["reach.daily", 98, 101, 600],
      ["reach.work", 135, 137, 750],
      ["points", 3085, 3105, 900],
      ["said", 2303, 2315, 1050],
    ]);
  });

  it("leaves still values out: no growth, no review, no streak step, no reach added", () => {
    const summary = makeSummary({
      growth: { faster: 0, fixed: 0, compared: 4, firstTime: 6, rows: [] },
      review: [],
      streak: { value: 13, restart: false, changed: false },
      reach: { topics: [], nearest: null },
      points: { earned: 0, total: 50 },
      totals: { said: 10, practicedDays: 1, last14: [], added: 0 },
    });
    expect(countUpPlan(summary)).toStrictEqual([]);
  });

  it("never counts a first day up from 0", () => {
    const plan = countUpPlan(
      makeSummary({ streak: { value: 1, restart: false, changed: true } }),
    );
    expect(plan.map((entry) => entry.key)).not.toContain("streak");
  });
});

describe("valueAt", () => {
  const entry = { key: "k", from: 10, to: 20, delayMs: 150, durationMs: 600 };

  it("holds the start before its delay and the end after its run", () => {
    expect(valueAt(entry, 0)).toBe(10);
    expect(valueAt(entry, 150)).toBe(10);
    expect(valueAt(entry, 750)).toBe(20);
    expect(valueAt(entry, Number.POSITIVE_INFINITY)).toBe(20);
  });

  it("climbs in whole steps, easing out", () => {
    const midway = valueAt(entry, 450);
    expect(Number.isInteger(midway)).toBe(true);
    expect(midway).toBeGreaterThan(15);
    expect(midway).toBeLessThan(20);
  });
});
