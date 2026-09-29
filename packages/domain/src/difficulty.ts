import { isFast, paceOf, type Paced } from "./timer";
import { TUNING } from "./tuning";
import type { AnswerResult } from "./types";

export interface DifficultyAnswer extends Paced {
  /** Absent on an answer kept before the window named its card; each counts on its own. */
  readonly cardId?: string;
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
 * under the down bar, `held` between them or under it on too few cards to
 * fail, and `unknown` on fewer cards than either `TUNING.difficulty.minPerLevel`.
 */
type Verdict = "cleared" | "held" | "failed" | "unknown";

/** Each card's latest answer, so a card seen on several days counts once. */
function latestPerCard(answers: readonly DifficultyAnswer[]): DifficultyAnswer[] {
  const latest = new Map<string, DifficultyAnswer>();
  const unnamed: DifficultyAnswer[] = [];
  for (const answer of answers) {
    if (answer.cardId === undefined) {
      unnamed.push(answer);
      continue;
    }
    const held = latest.get(answer.cardId);
    if (held === undefined || held.answeredAt <= answer.answeredAt) {
      latest.set(answer.cardId, answer);
    }
  }
  return [...unnamed, ...latest.values()];
}

function verdictOf(all: readonly DifficultyAnswer[]): Verdict {
  const { minPerLevel, upOkRate, upFastRate, downOkRate } = TUNING.difficulty;
  const answers = latestPerCard(all);
  if (answers.length < Math.min(minPerLevel.clear, minPerLevel.fail)) {
    return "unknown";
  }
  const oks = answers.filter((answer) => answer.result === "ok");
  const fast = oks.filter((answer) => isFast(answer.elapsedMs, paceOf(answer)));
  const okRate = oks.length / answers.length;
  const fastRate = oks.length === 0 ? 0 : fast.length / oks.length;
  if (okRate < downOkRate) {
    return answers.length < minPerLevel.fail ? "held" : "failed";
  }
  return okRate >= upOkRate && fastRate >= upFastRate ? "cleared" : "held";
}

/**
 * The level the answers show from `level`, or null while no card level has
 * enough cards answered to judge.
 *
 * @remarks
 * Each card level is judged on its own cards in the window, a card by its
 * latest answer. A failed level comes down to the highest level below it that
 * has not failed. A held level stays. Otherwise the level rises to the highest
 * cleared one above it, passing only levels too thin to judge, so a held or
 * failed level on the way stops the climb.
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
  if (verdictAt(level) === "held") {
    return level;
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
 * The level after a non-placement round: where `suggestLevel` points, but no
 * more than one step past where the answers before `since` already pointed,
 * so the answers of one close alone never move the level more than a step,
 * however its deck was made up. Evidence spanning several closes still moves
 * it several steps at once.
 *
 * @param since - When the closing round started: answers from then on are its own.
 */
export function adjustLevel(
  level: number,
  answers: readonly DifficultyAnswer[],
  since: number,
): LevelAdjustment {
  const earlier = answers.filter((answer) => answer.answeredAt < since);
  const before = suggestLevel(level, earlier) ?? level;
  const shown = suggestLevel(level, answers) ?? level;
  const moved = Math.min(
    Math.max(level, before) + 1,
    Math.max(Math.min(level, before) - 1, shown),
  );
  if (moved > level) {
    return { level: moved, change: "up" };
  }
  if (moved < level) {
    return { level: moved, change: "down" };
  }
  return { level, change: "same" };
}
