import { describe, expect, it } from "vitest";

import {
  adjustLevel,
  type AnswerResult,
  type DifficultyAnswer,
} from "@instant-composition/domain";

/** `n` answers at `level`: `ok` of them correct, `fast` of those within half the limit. */
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
    limitMs: 10_000,
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
