import { describe, expect, it } from "vitest";

import {
  outcomeOf,
  replayItems,
  reviewAnswer,
  type AcceptedAnswer,
  type ItemProgress,
  type ReviewEntry,
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

/** Folds answers through `reviewAnswer` in arrival order, as a run of commands would. */
function folded(answers: readonly AcceptedAnswer[]): {
  readonly progress: ItemProgress | undefined;
  readonly log: readonly ReviewEntry[];
} {
  let progress: ItemProgress | undefined;
  const log: ReviewEntry[] = [];
  for (const next of answers) {
    const reviewed = reviewAnswer(progress, next);
    progress = reviewed.progress;
    log.push(reviewed.entry);
  }
  return { progress, log };
}

function fold(answers: readonly AcceptedAnswer[]): ItemProgress | undefined {
  return folded(answers).progress;
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

  it("logs a first pass older than the item's latest with the state unchanged, and leaves the item", () => {
    const before = fold([answer({ id: "a2", sessionId: "r2", answeredAt: 9 })]);
    const { entry, progress } = reviewAnswer(
      before,
      answer({ result: "ng", answeredAt: 5 }),
    );
    expect(entry).toMatchObject({ outcome: "again", answeredAt: 5 });
    expect(entry.before).toStrictEqual(before?.memory);
    expect(entry.after).toStrictEqual(before?.memory);
    expect(progress).toBe(before);
  });

  it("leaves an item alone for a first pass given for a day before its last", () => {
    const before = fold([answer({ day: "2026-09-23", answeredAt: 3 })]);
    const { progress } = reviewAnswer(
      before,
      answer({ id: "a2", sessionId: "r0", answeredAt: 7 }),
    );
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

  it("leaves an item never seen unseen after a retry", () => {
    const { entry, progress } = reviewAnswer(undefined, answer({ pass: "retry" }));
    expect(progress).toBeUndefined();
    expect(entry.before).toBeNull();
    expect(entry.after).toBeNull();
    expect(replayItems([entry]).has("c1")).toBe(false);
  });

  it("does not count a correct retry toward mastery", () => {
    const progress = fold([
      answer({ day: "2026-09-20", answeredAt: 1 }),
      answer({
        id: "a2",
        sessionId: "r2",
        pass: "retry",
        day: "2026-09-22",
        answeredAt: 2,
      }),
    ]);
    expect(progress?.okDays).toStrictEqual(["2026-09-20"]);
    expect(progress?.mastered).toBeNull();
  });

  it("keeps an earlier correct day through a timeout and a miss", () => {
    const progress = fold([
      answer({ day: "2026-09-18", answeredAt: 1 }),
      answer({
        id: "a2",
        sessionId: "r2",
        result: "timeout",
        elapsedMs: 10_000,
        day: "2026-09-19",
        answeredAt: 2,
      }),
      answer({
        id: "a3",
        sessionId: "r3",
        result: "ng",
        day: "2026-09-20",
        answeredAt: 3,
      }),
      answer({ id: "a4", sessionId: "r4", day: "2026-09-21", answeredAt: 4 }),
    ]);
    expect(progress?.okDays).toStrictEqual(["2026-09-18", "2026-09-21"]);
    expect(progress?.mastered).toStrictEqual({ day: "2026-09-21", sessionId: "r4" });
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

  it("skips a late first pass as the commands did, though it sorts before what it followed", () => {
    const { progress, log } = folded([
      answer({ answeredAt: 1 }),
      answer({ id: "a3", sessionId: "r3", day: "2026-09-24", answeredAt: 30 }),
      answer({ id: "a2", sessionId: "r2", day: "2026-09-23", answeredAt: 20 }),
      answer({
        id: "a4",
        sessionId: "r4",
        day: "2026-09-25",
        result: "ng",
        answeredAt: 40,
      }),
    ]);

    expect(progress?.memory.lastDay).toBe("2026-09-25");
    expect(progress?.okDays).toStrictEqual(["2026-09-22", "2026-09-24"]);
    expect(replayItems([...log].reverse()).get("c1")).toStrictEqual(progress);
  });

  it("refuses a first pass logged without a memory state", () => {
    expect(() => replayItems([makeReview({ after: null })])).toThrow(RangeError);
  });
});
