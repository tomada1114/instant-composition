import { describe, expect, it } from "vitest";

import {
  nextCardState,
  type CardState,
  type LeitnerAnswer,
} from "@instant-composition/domain";

// Worked examples against TUNING's intervals [1, 2, 4, 7, 14, 30] and a
// 10-second pace, where "fast" is 5 seconds or less.

function leitner(overrides: Partial<LeitnerAnswer> = {}): LeitnerAnswer {
  return {
    day: "2026-09-22",
    result: "ok",
    elapsedMs: 8_000,
    paceMs: 10_000,
    ...overrides,
  };
}

function stepThrough(answers: readonly LeitnerAnswer[]): CardState | undefined {
  let state: CardState | undefined;
  for (const next of answers) {
    state = nextCardState(state, next);
  }
  return state;
}

describe("the first answer to a new card", () => {
  it.each([
    ["ok", 8_000, 1, "2026-09-24"],
    ["ok", 5_000, 2, "2026-09-26"],
    ["ok", 5_001, 1, "2026-09-24"],
    ["ng", 3_000, 0, "2026-09-23"],
    ["timeout", 10_000, 0, "2026-09-23"],
  ] as const)(
    "puts a %s in %p ms into box %p, due %s",
    (result, elapsedMs, box, dueDay) => {
      expect(nextCardState(undefined, leitner({ result, elapsedMs }))).toStrictEqual({
        box,
        lastDay: "2026-09-22",
        dueDay,
        seenCount: 1,
      });
    },
  );
});

describe("a later answer", () => {
  it("moves an ok up one box and a fast ok up two", () => {
    expect(
      stepThrough([
        leitner({ day: "2026-09-01" }),
        leitner({ day: "2026-09-02" }),
        leitner({ day: "2026-09-04", elapsedMs: 2_000 }),
      ]),
    ).toStrictEqual({
      box: 4,
      lastDay: "2026-09-04",
      dueDay: "2026-09-18",
      seenCount: 3,
    });
  });

  it("stops at the last box", () => {
    const answers = ["01", "02", "03", "04", "05"].map((dd) =>
      leitner({ day: `2026-09-${dd}`, elapsedMs: 1_000 }),
    );
    expect(stepThrough(answers)).toStrictEqual({
      box: 5,
      lastDay: "2026-09-05",
      dueDay: "2026-10-05",
      seenCount: 5,
    });
  });

  it.each([
    ["ng", 3_000],
    ["timeout", 10_000],
  ] as const)(
    "drops a %s back to box 0, due the next day, and still counts it as seen",
    (result, elapsedMs) => {
      expect(
        stepThrough([
          leitner({ day: "2026-09-01", elapsedMs: 1_000 }),
          leitner({ day: "2026-09-03", result, elapsedMs }),
        ]),
      ).toStrictEqual({
        box: 0,
        lastDay: "2026-09-03",
        dueDay: "2026-09-04",
        seenCount: 2,
      });
    },
  );
});
