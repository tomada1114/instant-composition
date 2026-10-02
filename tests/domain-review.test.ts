import { describe, expect, it } from "vitest";

import {
  replayItems,
  reviewAnswer,
  scheduleCard,
  type AcceptedAnswer,
  type ItemProgress,
  type ReviewEntry,
} from "@instant-composition/domain";

import { FIRST_GOOD, makeLeitnerReview, makeReview } from "./application-fixtures";

function answer(overrides: Partial<AcceptedAnswer> = {}): AcceptedAnswer {
  return {
    id: "a1",
    sessionId: "r1",
    cardId: "c1",
    pass: "first",
    grade: "good",
    timedOut: false,
    elapsedMs: 6_000,
    limitMs: 10_000,
    paceMs: 10_000,
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

describe("reviewAnswer", () => {
  it("logs the grade, whether it timed out, and the FSRS state before and after a first pass", () => {
    const { entry, progress } = reviewAnswer(undefined, answer());
    const after = scheduleCard(undefined, "good", "2026-09-22", "c1").state;
    expect(entry).toMatchObject({
      item: { kind: "composition", id: "c1" },
      outcome: "good",
      before: null,
      after: null,
      fsrs: { before: null, after },
      detail: {
        activity: "composition",
        pass: "first",
        result: "ok",
        grade: "good",
        timedOut: false,
        elapsedMs: 6_000,
      },
    });
    expect(after).toMatchObject({
      reps: 1,
      lastDay: "2026-09-22",
      dueDay: "2026-09-25",
    });
    expect(progress).toMatchObject({
      fsrs: after,
      okDays: ["2026-09-22"],
      mastered: null,
    });
    expect(progress).not.toHaveProperty("memory");
  });

  it.each([
    ["again", false, "ng", "2026-09-23"],
    ["hard", false, "ok", "2026-09-24"],
    ["good", false, "ok", "2026-09-25"],
    ["again", true, "timeout", "2026-09-23"],
    ["hard", true, "timeout", "2026-09-24"],
    ["good", true, "timeout", "2026-09-25"],
  ] as const)(
    "schedules a new card graded %s (timed out: %s) by the grade, and counts it %s",
    (grade, timedOut, result, dueDay) => {
      const { entry, progress } = reviewAnswer(undefined, answer({ grade, timedOut }));
      expect(entry.detail).toMatchObject({ grade, timedOut, result });
      expect(progress?.fsrs?.dueDay).toBe(dueDay);
      expect(progress?.okDays).toStrictEqual(result === "ok" ? ["2026-09-22"] : []);
      expect(progress?.last?.result).toBe(result);
    },
  );

  it("logs a re-ask with the state unchanged, and leaves the item as it was", () => {
    const before = fold([answer({ grade: "again" })]);
    const { entry, progress } = reviewAnswer(
      before,
      answer({ id: "a2", pass: "retry", grade: "hard" }),
    );
    expect(entry.fsrs).toStrictEqual({ before: before?.fsrs, after: before?.fsrs });
    expect(entry.detail.grade).toBe("hard");
    expect(progress).toBe(before);
  });

  it("logs a second first pass the same day with the state unchanged, and leaves the item", () => {
    const before = fold([answer({ answeredAt: 1 })]);
    const { entry, progress } = reviewAnswer(
      before,
      answer({ id: "a2", sessionId: "r2", grade: "again", answeredAt: 9 }),
    );
    expect(entry).toMatchObject({ outcome: "again", answeredAt: 9 });
    expect(entry.fsrs).toStrictEqual({ before: before?.fsrs, after: before?.fsrs });
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

  it("moves an item on a later day's first pass whenever it was answered", () => {
    const before = fold([answer({ answeredAt: 50 })]);
    const { progress } = reviewAnswer(
      before,
      answer({ id: "a2", sessionId: "r2", day: "2026-09-25", answeredAt: 20 }),
    );
    expect(progress?.fsrs).toStrictEqual(
      scheduleCard(before?.fsrs, "good", "2026-09-25", "c1").state,
    );
  });

  it("schedules a card seen only under Leitner as a new card, keeping its Leitner state as it was", () => {
    const memory = {
      box: 3,
      dueDay: "2026-09-21",
      lastDay: "2026-09-14",
      seenCount: 3,
    };
    const seen: ItemProgress = {
      item: { kind: "composition", id: "c1" },
      memory,
      okDays: ["2026-09-10", "2026-09-14"],
      mastered: { day: "2026-09-14", sessionId: "r0" },
      placement: { topic: "work", subtopic: "a" },
      last: { sessionId: "r0", result: "ok", elapsedMs: 3_000, answeredAt: 0 },
      previous: null,
    };
    const { entry, progress } = reviewAnswer(seen, answer());
    expect(entry).toMatchObject({ before: memory, after: memory });
    expect(entry.fsrs).toStrictEqual({ before: null, after: progress?.fsrs });
    expect(progress).toMatchObject({
      memory,
      fsrs: { reps: 1, lapses: 0, dueDay: "2026-09-25" },
      mastered: { day: "2026-09-14", sessionId: "r0" },
    });
  });

  it("masters an item said in time on its first pass on two different days", () => {
    const progress = fold([
      answer(),
      answer({ id: "a2", sessionId: "r2", answeredAt: 2 }),
      answer({ id: "a3", sessionId: "r3", day: "2026-09-23", answeredAt: 3 }),
      answer({ id: "a4", sessionId: "r4", day: "2026-09-24", answeredAt: 4 }),
    ]);
    expect(progress?.okDays).toStrictEqual(["2026-09-22", "2026-09-23"]);
    expect(progress?.mastered).toStrictEqual({ day: "2026-09-23", sessionId: "r3" });
  });

  it("leaves an item never seen unseen after a re-ask", () => {
    const { entry, progress } = reviewAnswer(undefined, answer({ pass: "retry" }));
    expect(progress).toBeUndefined();
    expect(entry.fsrs).toStrictEqual({ before: null, after: null });
    expect(replayItems([entry]).has("c1")).toBe(false);
  });

  it("does not count a re-ask said in time toward mastery", () => {
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

  it("keeps an earlier day said in time through a timeout and a miss", () => {
    const progress = fold([
      answer({ day: "2026-09-18", answeredAt: 1 }),
      answer({
        id: "a2",
        sessionId: "r2",
        grade: "good",
        timedOut: true,
        elapsedMs: 10_000,
        day: "2026-09-19",
        answeredAt: 2,
      }),
      answer({
        id: "a3",
        sessionId: "r3",
        grade: "again",
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
      answer({
        id: "a2",
        sessionId: "r2",
        grade: "again",
        day: "2026-09-23",
        answeredAt: 2,
      }),
      answer({
        id: "a3",
        sessionId: "r3",
        elapsedMs: 4_000,
        day: "2026-09-24",
        answeredAt: 3,
      }),
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
  it("rebuilds from the log in time order whatever order it is handed, copying each state it logged", () => {
    const moved = {
      ...FIRST_GOOD,
      reps: 2,
      lastDay: "2026-09-23",
      dueDay: "2026-10-03",
    };
    const later = makeReview({
      id: "b",
      answeredAt: 9,
      day: "2026-09-23",
      fsrs: { before: FIRST_GOOD, after: moved },
    });
    const earlier = makeReview({ id: "a", answeredAt: 1 });
    const retry = makeReview({
      id: "c",
      answeredAt: 5,
      fsrs: { before: FIRST_GOOD, after: FIRST_GOOD },
      detail: { ...earlier.detail, pass: "retry" },
    });

    const items = replayItems([later, retry, earlier]);

    expect(items.get("c1")).toMatchObject({
      fsrs: moved,
      okDays: ["2026-09-22", "2026-09-23"],
      mastered: { day: "2026-09-23", sessionId: "r1" },
      last: { answeredAt: 9 },
    });
  });

  it("carries a Leitner history into the item an FSRS review then schedules", () => {
    const leitner = makeLeitnerReview();
    const first = makeReview({
      before: leitner.after,
      after: leitner.after,
      fsrs: { before: null, after: FIRST_GOOD },
    });

    const items = replayItems([first, leitner]);

    expect(items.get("c1")).toMatchObject({
      memory: leitner.after,
      fsrs: FIRST_GOOD,
      okDays: ["2026-09-20", "2026-09-22"],
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
        grade: "again",
        answeredAt: 40,
      }),
    ]);

    expect(progress?.fsrs?.lastDay).toBe("2026-09-25");
    expect(progress?.okDays).toStrictEqual(["2026-09-22", "2026-09-24"]);
    expect(replayItems([...log].reverse()).get("c1")).toStrictEqual(progress);
  });

  it("refuses a first pass logged with no state at all", () => {
    expect(() => replayItems([makeLeitnerReview({ after: null })])).toThrow(RangeError);
  });
});
