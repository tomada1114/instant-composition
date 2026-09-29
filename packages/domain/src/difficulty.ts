import { isFast, paceOf, type Paced } from "./timer";
import { TUNING } from "./tuning";
import type { AnswerResult } from "./types";

export interface DifficultyAnswer extends Paced {
  readonly level: number;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
  readonly answeredAt: number;
}

export type LevelChange = "up" | "down" | "same";

export interface LevelAdjustment {
  readonly level: number;
  readonly change: LevelChange;
}

/**
 * What the window shows of one card level: `cleared` at the up bars, `failed`
 * under the down bar, `held` between them, and `unknown` below
 * `TUNING.difficulty.minPerLevel` answers.
 */
type Verdict = "cleared" | "held" | "failed" | "unknown";

function verdictOf(answers: readonly DifficultyAnswer[]): Verdict {
  const { minPerLevel, upOkRate, upFastRate, downOkRate } = TUNING.difficulty;
  if (answers.length < minPerLevel) {
    return "unknown";
  }
  const oks = answers.filter((answer) => answer.result === "ok");
  const fast = oks.filter((answer) => isFast(answer.elapsedMs, paceOf(answer)));
  const okRate = oks.length / answers.length;
  const fastRate = oks.length === 0 ? 0 : fast.length / oks.length;
  if (okRate < downOkRate) {
    return "failed";
  }
  return okRate >= upOkRate && fastRate >= upFastRate ? "cleared" : "held";
}

/**
 * The level the answers show from `level`, or null while no card level has
 * enough answers to judge.
 *
 * @remarks
 * Each card level is judged on its own answers in the window. A failed level
 * comes down to the highest level below it that has not failed; otherwise the
 * level rises to the highest cleared one above it, passing only levels too
 * thin to judge, so a held or failed level on the way stops the climb. One
 * round of ten is dealt too few cards off the level to judge two levels, so
 * it moves at most one step; a larger move needs the answers of several.
 *
 * @param answers - First-pass answers since the level was last placed or
 * picked, across the moves the answers made since.
 */
export function suggestLevel(
  level: number,
  answers: readonly DifficultyAnswer[],
): number | null {
  const levels = [...new Set(answers.map((answer) => answer.level))];
  const verdicts = new Map(
    levels.map((cardLevel) => [
      cardLevel,
      verdictOf(answers.filter((answer) => answer.level === cardLevel)),
    ]),
  );
  const verdictAt = (cardLevel: number): Verdict =>
    verdicts.get(cardLevel) ?? "unknown";
  if ([...verdicts.values()].every((verdict) => verdict === "unknown")) {
    return null;
  }

  if (verdictAt(level) === "failed") {
    let lower = level - 1;
    while (lower > 1 && verdictAt(lower) === "failed") {
      lower -= 1;
    }
    return Math.max(1, lower);
  }
  let target = level;
  const top = Math.max(...verdicts.keys());
  for (let upper = level + 1; upper <= top; upper += 1) {
    const verdict = verdictAt(upper);
    if (verdict === "cleared") {
      target = upper;
    } else if (verdict !== "unknown") {
      break;
    }
  }
  return target;
}

/**
 * The level after a non-placement round: where `suggestLevel` points, or
 * `level` itself while it points nowhere.
 */
export function adjustLevel(
  level: number,
  answers: readonly DifficultyAnswer[],
): LevelAdjustment {
  const suggested = suggestLevel(level, answers) ?? level;
  if (suggested > level) {
    return { level: suggested, change: "up" };
  }
  if (suggested < level) {
    return { level: suggested, change: "down" };
  }
  return { level, change: "same" };
}
