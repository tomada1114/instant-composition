import { addDays } from "./day";
import { TUNING } from "./tuning";
import type { AnswerRecord, DayKey } from "./types";

/**
 * A point per first-pass card, plus the bonus when the round completed a
 * portion. Tied to cards done, never to how many were correct.
 */
export function roundPoints(firstPassCards: number, completedPortion: boolean): number {
  return (
    firstPassCards * TUNING.points.perCard +
    (completedPortion ? TUNING.points.portionBonus : 0)
  );
}

export interface Totals {
  /** Every answer, retries included. */
  readonly said: number;
  readonly practicedDays: number;
  /** Oldest first, ending with `today`. */
  readonly last14: readonly { readonly day: DayKey; readonly count: number }[];
}

export function totals(answers: readonly AnswerRecord[], today: DayKey): Totals {
  const perDay = new Map<DayKey, number>();
  for (const answer of answers) {
    perDay.set(answer.day, (perDay.get(answer.day) ?? 0) + 1);
  }
  return {
    said: answers.length,
    practicedDays: perDay.size,
    last14: Array.from({ length: 14 }, (_, index) => {
      const day = addDays(today, index - 13);
      return { day, count: perDay.get(day) ?? 0 };
    }),
  };
}
