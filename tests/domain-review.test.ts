import { describe, expect, it } from "vitest";

import {
  outcomeOf,
  replayItems,
  reviewAnswer,
  type AcceptedAnswer,
  type ItemProgress,
} from "@instant-composition/domain";

import { makeReview } from "./application-fixtures";

function answer(overrides: Partial<AcceptedAnswer> = {}): AcceptedAnswer {
  return {
    id: "a1",
    sessionId: "r1",
    cardId: "c1",
    pass: "first",
    result: "ok",
    elapsedMs: 6_000,
    limitMs: 10_000,
    day: "2026-09-22",
    answeredAt: 1,
    snapshot: { topic: "work", subtopic: "a", level: 5, prompt: "文" },
    ...overrides,
  };
}

/** Folds answers through `reviewAnswer`, as a run of commands would. */
function fold(answers: readonly AcceptedAnswer[]): ItemProgress | undefined {
  let progress: ItemProgress | undefined;
  for (const next of answers) {
    progress = reviewAnswer(progress, next).progress;
  }
  return progress;
}

describe("outcomeOf", () => {
  it.each([
    ["ng", 1_000, "again"],
    ["timeout", 10_000, "again"],
    ["ok", 5_000, "easy"],
    ["ok", 5_001, "good"],
  ] as const)("maps %s in %i ms of 10 s to %s", (result, elapsedMs, outcome) => {
    expect(outcomeOf(result, elapsedMs, 10_000)).toBe(outcome);
  });
});

describe("reviewAnswer", () => {
  it("logs the memory state before and after a first pass", () => {
    const { entry, progress } = reviewAnswer(undefined, answer());
    expect(entry).toMatchObject({
      item: { kind: "composition", id: "c1" },
      outcome: "good",
      before: null,
      after: { box: 1, dueDay: "2026-09-24", lastDay: "2026-09-22", seenCount: 1 },
      detail: { activity: "composition", pass: "first", result: "ok" },
    });
    expect(progress).toMatchObject({
      memory: entry.after,
      okDays: ["2026-09-22"],
      mastered: null,
    });
  });

  it("logs a retry with the state unchanged, and leaves the item as it was", () => {
    const before = fold([answer({ result: "ng" })]);
    const { entry, progress } = reviewAnswer(
      before,
      answer({ id: "a2", pass: "retry" }),
    );
    expect(entry.before).toStrictEqual(before?.memory);
    expect(entry.after).toStrictEqual(before?.memory);
    expect(progress).toBe(before);
  });

  it("masters an item correct on its first pass on two different days", () => {
    const progress = fold([
      answer(),
      answer({ id: "a2", sessionId: "r2", answeredAt: 2 }),
      answer({ id: "a3", sessionId: "r3", day: "2026-09-23", answeredAt: 3 }),
      answer({ id: "a4", sessionId: "r4", day: "2026-09-24", answeredAt: 4 }),
    ]);
    expect(progress?.okDays).toStrictEqual(["2026-09-22", "2026-09-23"]);
    expect(progress?.mastered).toStrictEqual({ day: "2026-09-23", sessionId: "r3" });
  });

  it("keeps the latest first pass and the one from the session before it", () => {
    const progress = fold([
      answer({ elapsedMs: 9_000 }),
      answer({ id: "a2", sessionId: "r2", result: "ng", answeredAt: 2 }),
      answer({ id: "a3", sessionId: "r3", elapsedMs: 4_000, answeredAt: 3 }),
    ]);
    expect(progress?.last).toStrictEqual({
      sessionId: "r3",
      result: "ok",
      elapsedMs: 4_000,
      answeredAt: 3,
    });
    expect(progress?.previous).toStrictEqual({
      sessionId: "r2",
      result: "ng",
      elapsedMs: 6_000,
      answeredAt: 2,
    });
  });
});

describe("replayItems", () => {
  it("rebuilds from the log in time order whatever order it is handed", () => {
    const later = makeReview({
      id: "b",
      answeredAt: 9,
      day: "2026-09-23",
      before: null,
      after: { box: 3, dueDay: "2026-09-30", lastDay: "2026-09-23", seenCount: 2 },
    });
    const earlier = makeReview({ id: "a", answeredAt: 1 });
    const retry = makeReview({
      id: "c",
      answeredAt: 5,
      detail: { ...earlier.detail, pass: "retry" },
    });

    const items = replayItems([later, retry, earlier]);

    expect(items.get("c1")).toMatchObject({
      memory: later.after,
      okDays: ["2026-09-22", "2026-09-23"],
      mastered: { day: "2026-09-23", sessionId: "r1" },
      last: { answeredAt: 9 },
    });
  });

  it("refuses a first pass logged without a memory state", () => {
    expect(() => replayItems([makeReview({ after: null })])).toThrow(RangeError);
  });
});
