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

/** `answers(…)` from a closing round started at `ROUND_START`, each card named. */
function thisRound(
  cells: readonly (readonly [number, number, number, number])[],
): DifficultyAnswer[] {
  return window(...cells).map((answer, index) => ({
    ...answer,
    cardId: `now-${String(index)}`,
    answeredAt: ROUND_START + index,
  }));
}

const ROUND_START = 50_000;
const WORKED_FROM_EARLIER = window(
  [3, 6, 6, 4],
  [4, 12, 11, 7],
  [5, 7, 6, 4],
  [6, 3, 3, 2],
  [7, 2, 0, 0],
);
/** A close whose round started after every answer: the whole window is earlier evidence. */
const LATER = Number.POSITIVE_INFINITY;

describe("the level the answers show", () => {
  it("says nothing while no card level has three cards answered", () => {
    const thin = window([4, 2, 2, 2], [5, 2, 2, 2], [6, 2, 2, 2]);
    expect(suggestLevel(5, thin)).toBeNull();
    expect(adjustLevel(5, thin, LATER)).toStrictEqual({ level: 5, change: "same" });
  });

  // The worked example in TUNING.difficulty's pull request: at level 4, level 3
  // and 4 clear, level 5 clears at 6 of 7 with 4 of the 6 fast, and level 6 at
  // 3 of 3 with 2 fast, so the answers show level 6. Level 7's two misses are
  // too few to judge.
  const WORKED = WORKED_FROM_EARLIER;

  it("rises to the highest level cleared above it, several steps at once", () => {
    expect(suggestLevel(4, WORKED)).toBe(6);
    expect(adjustLevel(4, WORKED, LATER)).toStrictEqual({ level: 6, change: "up" });
  });

  it("passes over a level too thin to judge on the way to a cleared one", () => {
    expect(suggestLevel(4, window([4, 6, 6, 6], [5, 2, 2, 2], [6, 3, 3, 3]))).toBe(6);
  });

  it("climbs from a level too thin to judge itself", () => {
    expect(suggestLevel(4, window([4, 2, 1, 0], [5, 3, 3, 3]))).toBe(5);
  });

  it("stays at a level held between the bars, whatever clears above it", () => {
    expect(suggestLevel(5, window([5, 10, 7, 5], [6, 3, 3, 3], [7, 3, 3, 3]))).toBe(5);
  });

  it("stops the climb at a level held between the bars", () => {
    expect(suggestLevel(4, window([5, 7, 5, 5], [6, 3, 3, 3]))).toBe(4);
  });

  it("clears a level only when half of its correct answers are fast", () => {
    expect(suggestLevel(5, window([6, 4, 4, 1]))).toBe(5);
    expect(suggestLevel(5, window([6, 4, 4, 2]))).toBe(6);
  });

  it("judges fast by the pace, so a long limit does not make every ok fast", () => {
    const slow = answers(4, 4, 0, 6);
    expect(slow.every((answer) => answer.elapsedMs <= answer.limitMs / 2)).toBe(true);
    expect(suggestLevel(5, slow)).toBe(5);
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
    expect(suggestLevel(5, logged)).toBe(6);
  });

  it("counts a card answered on several days once, by its latest answer", () => {
    const again = (
      cardId: string,
      result: "ok" | "ng",
      answeredAt: number,
    ): DifficultyAnswer => ({
      cardId,
      level: 6,
      result,
      elapsedMs: 4_000,
      limitMs: 30_000,
      paceMs: 10_000,
      answeredAt,
    });
    const oneHardCard = [again("h", "ng", 1), again("h", "ng", 2), again("h", "ng", 3)];
    const relearned = [again("h", "ng", 1), again("h", "ng", 2), again("h", "ok", 3)];
    const two = [...relearned, again("p", "ok", 4)];
    expect(suggestLevel(6, [...oneHardCard, ...answers(4, 4, 4, 6)])).toBe(6);
    expect(suggestLevel(6, oneHardCard)).toBeNull();
    expect(suggestLevel(5, two)).toBeNull();
    expect(suggestLevel(5, [...two, again("q", "ok", 5)])).toBe(6);
  });

  it("comes down past every failed level to the highest one that has not failed", () => {
    const struggling = window([5, 2, 0, 0], [6, 4, 2, 0], [7, 8, 3, 1], [8, 3, 0, 0]);
    expect(suggestLevel(7, struggling)).toBe(5);
    expect(adjustLevel(7, struggling, LATER)).toStrictEqual({
      level: 5,
      change: "down",
    });
  });

  it("comes down one step when the level below has too few cards to judge", () => {
    expect(suggestLevel(7, window([6, 2, 0, 0], [7, 5, 2, 0], [8, 2, 0, 0]))).toBe(6);
  });

  it("fails a level only on four cards, holding it on three", () => {
    expect(suggestLevel(5, window([4, 3, 3, 3], [5, 3, 1, 0]))).toBe(5);
    expect(suggestLevel(5, window([4, 3, 3, 3], [5, 4, 2, 0]))).toBe(4);
  });

  it("comes down from a failed level even with a cleared one above it", () => {
    expect(suggestLevel(5, window([5, 5, 2, 0], [6, 3, 3, 3]))).toBe(4);
  });

  it("holds at a 60% ok rate exactly", () => {
    expect(suggestLevel(5, window([5, 5, 3, 0]))).toBe(5);
  });

  it("stays at a level whose next one up fails", () => {
    expect(
      suggestLevel(6, window([5, 3, 3, 3], [6, 8, 7, 5], [7, 4, 0, 0], [8, 3, 3, 3])),
    ).toBe(6);
  });

  it("never goes below 1 or past the highest card level answered", () => {
    expect(suggestLevel(1, window([1, 5, 0, 0], [2, 4, 0, 0]))).toBe(1);
    expect(suggestLevel(2, window([1, 4, 0, 0], [2, 5, 0, 0]))).toBe(1);
    expect(suggestLevel(10, window([9, 3, 3, 3], [10, 6, 6, 6]))).toBe(10);
  });
});

describe("moving the level at a close", () => {
  it("moves the worked example two steps when its window comes from earlier rounds", () => {
    expect(
      adjustLevel(
        4,
        [...WORKED_FROM_EARLIER, ...thisRound([[4, 5, 5, 3]])],
        ROUND_START,
      ),
    ).toStrictEqual({
      level: 6,
      change: "up",
    });
  });

  // Re-placed from 7 to 5 with level-6 and level-7 reviews due: one round of
  // reviews answered right and fast would show level 7 on its own.
  it("moves one step when the closing round alone shows two levels up", () => {
    const round = thisRound([
      [5, 4, 4, 3],
      [6, 3, 3, 3],
      [7, 3, 3, 3],
    ]);
    expect(suggestLevel(5, round)).toBe(7);
    expect(adjustLevel(5, round, ROUND_START)).toStrictEqual({
      level: 6,
      change: "up",
    });
  });

  it("moves one step on a deck made up from seven probe cards", () => {
    const round = thisRound([
      [5, 3, 3, 3],
      [7, 7, 7, 7],
    ]);
    expect(adjustLevel(5, round, ROUND_START)).toStrictEqual({
      level: 6,
      change: "up",
    });
  });

  it("drops one step when the closing round alone fails the level and the one below", () => {
    const round = thisRound([
      [4, 4, 0, 0],
      [5, 6, 1, 0],
    ]);
    expect(suggestLevel(5, round)).toBe(3);
    expect(adjustLevel(5, round, ROUND_START)).toStrictEqual({
      level: 4,
      change: "down",
    });
  });

  it("moves one step past what the earlier rounds showed, not more", () => {
    const earlier = window([5, 6, 6, 6], [6, 3, 3, 3], [7, 3, 3, 3]);
    const round = thisRound([
      [8, 3, 3, 3],
      [9, 3, 3, 3],
    ]);
    expect(suggestLevel(5, [...earlier, ...round])).toBe(9);
    expect(adjustLevel(5, [...earlier, ...round], ROUND_START)).toStrictEqual({
      level: 8,
      change: "up",
    });
  });

  // Every way of answering one round of ten as a 10-card deal lays it out
  // (2 below, 5 at, 2 above, 1 probe): right and fast, right and slow, or wrong.
  it("moves at most one step on any one round of ten, however it was answered", () => {
    const shape = [4, 4, 5, 5, 5, 5, 5, 6, 6, 7];
    const moves = new Set<number>();
    for (let code = 0; code < 3 ** shape.length; code += 1) {
      const round = shape.map((level, index): DifficultyAnswer => {
        const kind = Math.floor(code / 3 ** index) % 3;
        return {
          cardId: `c${String(index)}`,
          level,
          result: kind === 2 ? "ng" : "ok",
          elapsedMs: kind === 0 ? 4_000 : 8_000,
          limitMs: 30_000,
          paceMs: 10_000,
          answeredAt: ROUND_START + index,
        };
      });
      moves.add(adjustLevel(5, round, ROUND_START).level - 5);
    }
    expect([...moves].sort()).toStrictEqual([-1, 0]);
  });
});

describe("suggesting a level beside one picked by hand", () => {
  it("says nothing while no card level has three cards answered", () => {
    expect(suggestLevel(5, answers(2, 2, 2, 6))).toBeNull();
  });

  it("points where the answers show, however far, since nothing moves", () => {
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
