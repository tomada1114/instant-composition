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

describe("adjusting the level after a round", () => {
  it("waits for twenty answers before changing anything", () => {
    expect(adjustLevel(5, answers(19, 19, 19))).toStrictEqual({
      level: 5,
      change: "same",
    });
  });

  it("goes up on an 85% ok rate with half the oks fast", () => {
    expect(adjustLevel(5, answers(20, 17, 9))).toStrictEqual({
      level: 6,
      change: "up",
    });
  });

  it("judges fast by the pace, so a long limit does not make every ok fast", () => {
    const slow = answers(20, 20, 0);
    expect(slow.every((answer) => answer.elapsedMs <= answer.limitMs / 2)).toBe(true);
    expect(adjustLevel(5, slow)).toStrictEqual({ level: 5, change: "same" });
  });

  it("takes the limit as the pace for an answer logged before the limit was a setting", () => {
    const logged = answers(20, 20, 20).map(
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

  it("stays when the oks are mostly slow", () => {
    expect(adjustLevel(5, answers(20, 17, 8))).toStrictEqual({
      level: 5,
      change: "same",
    });
  });

  it("goes down below a 60% ok rate", () => {
    expect(adjustLevel(5, answers(20, 11, 0, 5, "timeout"))).toStrictEqual({
      level: 4,
      change: "down",
    });
  });

  it("stays at 60% exactly", () => {
    expect(adjustLevel(5, answers(20, 12, 0))).toStrictEqual({
      level: 5,
      change: "same",
    });
  });

  it("never goes past 10 or below 1", () => {
    expect(adjustLevel(10, answers(20, 20, 20, 10))).toStrictEqual({
      level: 10,
      change: "same",
    });
    expect(adjustLevel(1, answers(20, 0, 0, 1))).toStrictEqual({
      level: 1,
      change: "same",
    });
  });

  it("ignores answers to cards more than one level away", () => {
    const far = answers(20, 20, 20, 8);
    expect(adjustLevel(5, far)).toStrictEqual({ level: 5, change: "same" });
  });

  it("reads only the newest thirty", () => {
    const old = answers(10, 0, 0).map((a) => ({
      ...a,
      answeredAt: a.answeredAt - 500,
    }));
    expect(adjustLevel(5, [...old, ...answers(30, 30, 30)])).toStrictEqual({
      level: 6,
      change: "up",
    });
  });
});

describe("suggesting a level beside one picked by hand", () => {
  it("says nothing before twenty answers", () => {
    expect(suggestLevel(5, answers(19, 19, 19))).toBeNull();
  });

  it("points where adjusting would go, or to the level itself", () => {
    expect(suggestLevel(5, answers(20, 20, 20))).toBe(6);
    expect(suggestLevel(5, answers(20, 11, 0))).toBe(4);
    expect(suggestLevel(5, answers(20, 12, 0))).toBe(5);
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
    const strong = answers(20, 20, 20);
    const manual = makeStats({ ...PLACED, levelMode: "manual", levelWindow: strong });
    expect(suggestedLevel(manual)).toBe(6);
    expect(suggestedLevel({ ...manual, levelWindow: answers(5, 5, 5) })).toBeNull();
    expect(suggestedLevel({ ...PLACED, levelWindow: strong })).toBeNull();
    expect(suggestedLevel(makeStats({ levelMode: "manual" }))).toBeNull();
  });
});
