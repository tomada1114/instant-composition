import { addDays } from "./day";
import { isFast } from "./timer";
import { TUNING } from "./tuning";
import type { AnswerRecord, CardState } from "./types";

const LAST_BOX = TUNING.leitnerIntervalsDays.length - 1;

function nextBox(previous: number | undefined, answer: AnswerRecord): number {
  if (answer.result !== "ok") {
    return 0;
  }
  const step = isFast(answer.elapsedMs, answer.limitMs) ? 2 : 1;
  return Math.min(LAST_BOX, (previous ?? 0) + step);
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
    const previous = states.get(answer.cardId);
    const box = nextBox(previous?.box, answer);
    states.set(answer.cardId, {
      box,
      lastDay: answer.day,
      dueDay: addDays(answer.day, TUNING.leitnerIntervalsDays[box] ?? 1),
      seenCount: (previous?.seenCount ?? 0) + 1,
    });
  }
  return states;
}
