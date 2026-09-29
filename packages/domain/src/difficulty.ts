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
 * The newest answers the level is judged on, or undefined while there are
 * too few of them to judge.
 */
function recentAround(
  level: number,
  answers: readonly DifficultyAnswer[],
): readonly DifficultyAnswer[] | undefined {
  const { window, minAnswers } = TUNING.difficulty;
  const recent = answers
    .filter((answer) => Math.abs(answer.level - level) <= 1)
    .sort((a, b) => b.answeredAt - a.answeredAt)
    .slice(0, window);
  return recent.length < minAnswers ? undefined : recent;
}

/**
 * The level after a non-placement round.
 *
 * @param answers - First-pass answers given since the level last changed, so
 * a fresh level starts from an empty window.
 */
export function adjustLevel(
  level: number,
  answers: readonly DifficultyAnswer[],
): LevelAdjustment {
  const { upOkRate, upFastRate, downOkRate } = TUNING.difficulty;
  const recent = recentAround(level, answers);
  if (recent === undefined) {
    return { level, change: "same" };
  }

  const oks = recent.filter((answer) => answer.result === "ok");
  const fast = oks.filter((answer) => isFast(answer.elapsedMs, paceOf(answer)));
  const okRate = oks.length / recent.length;
  const fastRate = oks.length === 0 ? 0 : fast.length / oks.length;

  if (okRate >= upOkRate && fastRate >= upFastRate && level < 10) {
    return { level: level + 1, change: "up" };
  }
  if (okRate < downOkRate && level > 1) {
    return { level: level - 1, change: "down" };
  }
  return { level, change: "same" };
}

/**
 * The level the answers point to from `level`, the one adjusting would move
 * to, or null while there are too few answers to say. A suggestion only: a
 * level picked by hand is shown it and never moved to it.
 */
export function suggestLevel(
  level: number,
  answers: readonly DifficultyAnswer[],
): number | null {
  return recentAround(level, answers) === undefined
    ? null
    : adjustLevel(level, answers).level;
}
