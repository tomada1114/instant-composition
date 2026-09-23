import { describe, expect, it } from "vitest";

import { deriveCardStates } from "../src/core/card-state";
import { makeAnswer } from "./core-fixtures";

// Worked examples against TUNING's intervals [1, 2, 4, 7, 14, 30] and a
// 10-second limit, where "fast" is 5 seconds or less.

describe("the first answer to a card", () => {
  it.each([
    ["ok", 8_000, 1, "2026-09-24"],
    ["ok", 5_000, 2, "2026-09-26"],
    ["ng", 3_000, 0, "2026-09-23"],
    ["timeout", 10_000, 0, "2026-09-23"],
  ] as const)(
    "puts a %s in %p ms into box %p, due %s",
    (result, elapsedMs, box, dueDay) => {
      const states = deriveCardStates([makeAnswer({ result, elapsedMs })]);
      expect(states.get("c1")).toStrictEqual({
        box,
        dueDay,
        lastDay: "2026-09-22",
        seenCount: 1,
      });
    },
  );
});

describe("a later answer", () => {
  it("moves an ok up one box and a fast ok up two", () => {
    const states = deriveCardStates([
      makeAnswer({ day: "2026-09-01", answeredAt: 1 }),
      makeAnswer({ day: "2026-09-02", answeredAt: 2 }),
      makeAnswer({ day: "2026-09-04", answeredAt: 3, elapsedMs: 2_000 }),
    ]);
    expect(states.get("c1")).toMatchObject({
      box: 4,
      lastDay: "2026-09-04",
      dueDay: "2026-09-18",
      seenCount: 3,
    });
  });

  it("stops at the last box", () => {
    const answers = Array.from({ length: 5 }, (_, index) =>
      makeAnswer({
        day: `2026-09-0${String(index + 1)}`,
        answeredAt: index,
        elapsedMs: 1_000,
      }),
    );
    expect(deriveCardStates(answers).get("c1")).toMatchObject({
      box: 5,
      dueDay: "2026-10-05",
    });
  });

  it("drops a miss back to box 0, due the next day", () => {
    const states = deriveCardStates([
      makeAnswer({ day: "2026-09-01", answeredAt: 1, elapsedMs: 1_000 }),
      makeAnswer({ day: "2026-09-03", answeredAt: 2, result: "ng" }),
    ]);
    expect(states.get("c1")).toMatchObject({ box: 0, dueDay: "2026-09-04" });
  });

  it("applies answers in time order whatever order they arrive in", () => {
    const states = deriveCardStates([
      makeAnswer({ day: "2026-09-03", answeredAt: 2, result: "ng" }),
      makeAnswer({ day: "2026-09-01", answeredAt: 1 }),
    ]);
    expect(states.get("c1")).toMatchObject({ box: 0, lastDay: "2026-09-03" });
  });
});

describe("a retry", () => {
  it("moves nothing and does not make a card seen", () => {
    const states = deriveCardStates([
      makeAnswer({ cardId: "c1", result: "ng", answeredAt: 1 }),
      makeAnswer({ cardId: "c1", pass: "retry", result: "ok", answeredAt: 2 }),
      makeAnswer({ cardId: "c2", pass: "retry", result: "ok", answeredAt: 3 }),
    ]);
    expect(states.get("c1")).toMatchObject({ box: 0, seenCount: 1 });
    expect(states.has("c2")).toBe(false);
  });
});
