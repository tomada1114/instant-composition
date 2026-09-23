import { addDays } from "./day";
import { isFast } from "./timer";
import { TUNING } from "./tuning";
import type { AnswerRecord, AnswerResult, CardState, DayKey } from "./types";

const LAST_BOX = TUNING.leitnerIntervalsDays.length - 1;

/** The facts of a first-pass answer the Leitner step reads. */
export interface LeitnerAnswer {
  readonly day: DayKey;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
  readonly limitMs: number;
}

/** A card's state after one more first-pass answer; `previous` is undefined for a new card. */
export function nextCardState(
  previous: CardState | undefined,
  answer: LeitnerAnswer,
): CardState {
  const box =
    answer.result === "ok"
      ? Math.min(
          LAST_BOX,
          (previous?.box ?? 0) + (isFast(answer.elapsedMs, answer.limitMs) ? 2 : 1),
        )
      : 0;
  return {
    box,
    lastDay: answer.day,
    dueDay: addDays(answer.day, TUNING.leitnerIntervalsDays[box] ?? 1),
    seenCount: (previous?.seenCount ?? 0) + 1,
  };
}

/**
 * Every card's Leitner state, replayed from its first-pass answers in time order.
 *
 * @remarks
 * A retry is the same day's second look at a missed card, so it neither moves
 * the box nor makes a card seen.
 */
export function deriveCardStates(
  answers: readonly AnswerRecord[],
): Map<string, CardState> {
  const firstPass = answers
    .filter((answer) => answer.pass === "first")
    .sort((a, b) => a.answeredAt - b.answeredAt);
  const states = new Map<string, CardState>();
  for (const answer of firstPass) {
    states.set(answer.cardId, nextCardState(states.get(answer.cardId), answer));
  }
  return states;
}
