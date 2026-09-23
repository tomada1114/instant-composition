import { isFast } from "./timer";
import { TUNING } from "./tuning";
import type { AnswerResult } from "./types";

export interface DifficultyAnswer {
  readonly level: number;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
  readonly limitMs: number;
  readonly answeredAt: number;
}

export type LevelChange = "up" | "down" | "same";

export interface LevelAdjustment {
  readonly level: number;
  readonly change: LevelChange;
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
  const { window, minAnswers, upOkRate, upFastRate, downOkRate } = TUNING.difficulty;
  const recent = answers
    .filter((answer) => Math.abs(answer.level - level) <= 1)
    .sort((a, b) => b.answeredAt - a.answeredAt)
    .slice(0, window);
  if (recent.length < minAnswers) {
    return { level, change: "same" };
  }

  const oks = recent.filter((answer) => answer.result === "ok");
  const fast = oks.filter((answer) => isFast(answer.elapsedMs, answer.limitMs));
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
