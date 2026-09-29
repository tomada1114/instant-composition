import { describe, expect, it } from "vitest";

import {
  adjustLevel,
  decideLevel,
  suggestedLevel,
  suggestLevel,
  type AnswerResult,
  type DifficultyAnswer,
  type LearnerStats,
} from "@instant-composition/domain";

import { makeStats } from "./application-fixtures";

/**
 * `n` answers at `level` on cards with a 10-second pace, in rounds dealt with a
 * 30-second limit: `ok` of them correct, `fast` of those within half the pace.
 */
function answers(
  n: number,
  ok: number,
  fast: number,
  level = 5,
  miss: AnswerResult = "ng",
): DifficultyAnswer[] {
  return Array.from({ length: n }, (_, index) => ({
    level,
    result: index < ok ? "ok" : miss,
    elapsedMs: index < fast ? 4_000 : 8_000,
    limitMs: 30_000,
    paceMs: 10_000,
    answeredAt: 1_000 + index,
  }));
}

/** Answers at several card levels, each `[level, n, ok, fast]` as `answers` takes them. */
function window(
  ...cells: readonly (readonly [number, number, number, number])[]
): DifficultyAnswer[] {
  return cells.flatMap(([level, n, ok, fast]) => answers(n, ok, fast, level));
}

describe("the level the answers show", () => {
  it("says nothing while no card level has three answers", () => {
    const thin = window([4, 2, 2, 2], [5, 2, 2, 2], [6, 2, 2, 2]);
    expect(suggestLevel(5, thin)).toBeNull();
    expect(adjustLevel(5, thin)).toStrictEqual({ level: 5, change: "same" });
  });

  // The worked example in TUNING.difficulty's pull request: at level 4, level 3
  // and 4 clear, level 5 clears at 6 of 7 with 4 of the 6 fast, and level 6 at
  // 3 of 3 with 2 fast, so the level goes to 6 in one close. Level 7's two
  // misses are too few to judge.
  it("rises to the highest level cleared above it, several steps at once", () => {
    const shown = window(
      [3, 6, 6, 4],
      [4, 12, 11, 7],
      [5, 7, 6, 4],
      [6, 3, 3, 2],
      [7, 2, 0, 0],
    );
    expect(adjustLevel(4, shown)).toStrictEqual({ level: 6, change: "up" });
  });

  it("passes over a level too thin to judge on the way to a cleared one", () => {
    expect(
      adjustLevel(4, window([4, 6, 6, 6], [5, 2, 2, 2], [6, 3, 3, 3])),
    ).toStrictEqual({ level: 6, change: "up" });
  });

  it("stops the climb at a level held between the bars", () => {
    expect(adjustLevel(4, window([5, 7, 5, 5], [6, 3, 3, 3]))).toStrictEqual({
      level: 4,
      change: "same",
    });
  });

  it("clears a level only when half of its correct answers are fast", () => {
    expect(adjustLevel(5, window([6, 4, 4, 1]))).toStrictEqual({
      level: 5,
      change: "same",
    });
    expect(adjustLevel(5, window([6, 4, 4, 2]))).toStrictEqual({
      level: 6,
      change: "up",
    });
  });

  it("judges fast by the pace, so a long limit does not make every ok fast", () => {
    const slow = answers(4, 4, 0, 6);
    expect(slow.every((answer) => answer.elapsedMs <= answer.limitMs / 2)).toBe(true);
    expect(adjustLevel(5, slow)).toStrictEqual({ level: 5, change: "same" });
  });

  it("takes the limit as the pace for an answer logged before the limit was a setting", () => {
    const logged = answers(4, 4, 4, 6).map(
      ({ level, result, elapsedMs, answeredAt }): DifficultyAnswer => ({
        level,
        result,
        elapsedMs,
        answeredAt,
        limitMs: 8_000,
      }),
    );
    expect(adjustLevel(5, logged)).toStrictEqual({ level: 6, change: "up" });
  });

  it("comes down past every failed level to the highest one that has not failed", () => {
    const struggling = window([5, 2, 0, 0], [6, 4, 2, 0], [7, 8, 3, 1], [8, 3, 0, 0]);
    expect(adjustLevel(7, struggling)).toStrictEqual({ level: 5, change: "down" });
  });

  it("comes down one step when the level below has too few answers to judge", () => {
    expect(
      adjustLevel(7, window([6, 2, 0, 0], [7, 5, 2, 0], [8, 2, 0, 0], [9, 1, 0, 0])),
    ).toStrictEqual({ level: 6, change: "down" });
  });

  it("comes down from a failed level even with a cleared one above it", () => {
    expect(adjustLevel(5, window([5, 5, 2, 0], [6, 3, 3, 3]))).toStrictEqual({
      level: 4,
      change: "down",
    });
  });

  it("holds at a 60% ok rate exactly", () => {
    expect(adjustLevel(5, window([5, 5, 3, 0]))).toStrictEqual({
      level: 5,
      change: "same",
    });
  });

  it("stays at a level whose next one up fails", () => {
    expect(
      adjustLevel(6, window([5, 3, 3, 3], [6, 8, 7, 5], [7, 3, 0, 0], [8, 3, 3, 3])),
    ).toStrictEqual({
      level: 6,
      change: "same",
    });
  });

  it("never goes below 1 or past the highest card level answered", () => {
    expect(adjustLevel(1, window([1, 5, 0, 0], [2, 3, 0, 0]))).toStrictEqual({
      level: 1,
      change: "same",
    });
    expect(adjustLevel(2, window([1, 3, 0, 0], [2, 5, 0, 0]))).toStrictEqual({
      level: 1,
      change: "down",
    });
    expect(adjustLevel(10, window([9, 3, 3, 3], [10, 6, 6, 6]))).toStrictEqual({
      level: 10,
      change: "same",
    });
  });

  // Every way of answering one round of ten as a 10-card deal lays it out
  // (TUNING.mix.levelShare: 2 below, 5 at, 2 above, 1 probe): right and fast,
  // right and slow, or wrong. No level but the learner's own gets three answers.
  it("moves at most one step on any one round of ten, however it was answered", () => {
    const shape = [4, 4, 5, 5, 5, 5, 5, 6, 6, 7];
    const moves = new Set<number>();
    for (let code = 0; code < 3 ** shape.length; code += 1) {
      const round = shape.map((level, index): DifficultyAnswer => {
        const kind = Math.floor(code / 3 ** index) % 3;
        return {
          level,
          result: kind === 2 ? "ng" : "ok",
          elapsedMs: kind === 0 ? 4_000 : 8_000,
          limitMs: 30_000,
          paceMs: 10_000,
          answeredAt: index,
        };
      });
      moves.add(adjustLevel(5, round).level - 5);
    }
    expect([...moves].sort()).toStrictEqual([-1, 0]);
  });
});

describe("suggesting a level beside one picked by hand", () => {
  it("says nothing while no card level has three answers", () => {
    expect(suggestLevel(5, answers(2, 2, 2, 6))).toBeNull();
  });

  it("points where adjusting would go, or to the level itself", () => {
    expect(suggestLevel(5, window([5, 5, 5, 5], [6, 3, 3, 3], [7, 3, 3, 3]))).toBe(7);
    expect(suggestLevel(5, window([4, 3, 3, 0], [5, 5, 2, 0]))).toBe(4);
    expect(suggestLevel(5, window([5, 5, 3, 0]))).toBe(5);
  });
});

const PLACED: LearnerStats = makeStats({
  level: { level: 5, reason: "placement", roundId: "p0", at: 0 },
  levelWindow: answers(10, 10, 10),
});

describe("choosing the level", () => {
  it("fixes a level picked by hand, starting its window over", () => {
    const chosen = decideLevel(PLACED, { mode: "manual", level: 7 }, 50);
    expect(chosen).toStrictEqual({
      ok: true,
      value: {
        ...PLACED,
        level: { level: 7, reason: "chosen", roundId: null, at: 50 },
        levelMode: "manual",
        levelWindow: [],
      },
    });
  });

  it("fixes the level as it is, window and all, when the pick is the level already held", () => {
    const chosen = decideLevel(PLACED, { mode: "manual", level: 5 }, 50);
    expect(chosen).toStrictEqual({
      ok: true,
      value: { ...PLACED, levelMode: "manual" },
    });
  });

  it("hands a picked level back to the answers without moving it or its window", () => {
    const manual = makeStats({
      level: { level: 5, reason: "chosen", roundId: null, at: 0 },
      levelMode: "manual",
      levelWindow: answers(10, 10, 10),
    });
    expect(decideLevel(manual, { mode: "auto" }, 50)).toStrictEqual({
      ok: true,
      value: { ...manual, levelMode: "auto" },
    });
  });

  it("changes nothing when the mode and level are already the ones chosen", () => {
    const auto = decideLevel(PLACED, { mode: "auto" }, 50);
    expect(auto.ok && auto.value).toBe(PLACED);
    const manual = makeStats({ ...PLACED, levelMode: "manual" });
    const again = decideLevel(manual, { mode: "manual", level: 5 }, 50);
    expect(again.ok && again.value).toBe(manual);
  });

  it.each([0, 11, 5.5, Number.NaN])(
    "refuses level %s, which is off the scale",
    (level) => {
      expect(decideLevel(PLACED, { mode: "manual", level }, 50)).toStrictEqual({
        ok: false,
        error: { code: "ERR_BAD_REQUEST" },
      });
    },
  );

  it("suggests a level only beside one picked by hand, from its window", () => {
    const strong = window([5, 10, 10, 10], [6, 4, 4, 4]);
    const manual = makeStats({ ...PLACED, levelMode: "manual", levelWindow: strong });
    expect(suggestedLevel(manual)).toBe(6);
    expect(suggestedLevel({ ...manual, levelWindow: answers(2, 2, 2) })).toBeNull();
    expect(suggestedLevel({ ...PLACED, levelWindow: strong })).toBeNull();
    expect(suggestedLevel(makeStats({ levelMode: "manual" }))).toBeNull();
  });
});
