import { gradedOf, type GradeInput } from "./card-state";
import type { PracticeError } from "./errors";
import type { Round } from "./records";
import { err, ok, type Result } from "./result";
import type { Pass } from "./types";

/**
 * One answer as the client sends it: a grade with whether the timer ran out,
 * or an older client's result in its place; see `gradedOf`.
 */
export interface AnswerInput extends GradeInput {
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  readonly id: string;
  readonly roundId: string;
  readonly cardId: string;
  readonly pass: Pass;
  readonly elapsedMs: number;
  /** Epoch ms on the client's clock; absent, the server's time is taken. */
  readonly answeredAt?: number;
}

/** What the catalog knows of a card, shown or retired; see `RetiredCard` for the nulls. */
export interface CardFacts {
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly prompt: string | null;
  readonly words: number | null;
}

/**
 * Refuses the whole batch when any answer names another round or an unknown
 * card, or carries neither a grade nor a result. A finished round refuses
 * only a batch carrying an id it does not hold, so a replayed batch stays
 * safe after finish.
 */
export function checkAnswers(
  round: Round,
  inputs: readonly AnswerInput[],
  cards: ReadonlyMap<string, CardFacts>,
  recorded: ReadonlySet<string>,
): Result<undefined, PracticeError> {
  if (round.finishedAt !== null && inputs.some((input) => !recorded.has(input.id))) {
    return err({ code: "ERR_ROUND_CLOSED" });
  }
  const valid = inputs.every(
    (input) =>
      input.roundId === round.id &&
      round.deck.includes(input.cardId) &&
      cards.has(input.cardId) &&
      gradedOf(input) !== undefined,
  );
  return valid ? ok(undefined) : err({ code: "ERR_BAD_REQUEST" });
}
