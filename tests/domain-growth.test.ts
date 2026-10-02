import { describe, expect, it } from "vitest";

import { roundPoints, totals } from "@instant-composition/domain";
import { makeAnswer } from "./domain-fixtures";

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
