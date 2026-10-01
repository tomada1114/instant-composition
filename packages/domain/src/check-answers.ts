import type { PracticeError } from "./errors";
import type { Round } from "./records";
import { err, ok, type Result } from "./result";
import { answerModeOf } from "./timer";
import type { AnswerResult, Pass } from "./types";

/** One answer as the client sends it. */
export interface AnswerInput {
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  readonly id: string;
  readonly roundId: string;
  readonly cardId: string;
  readonly pass: Pass;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
  /** Epoch ms on the client's clock; absent, the server's time is taken. */
  readonly answeredAt?: number;
  /** What the learner typed; taken only in a typed round. */
  readonly text?: string;
}

/** What the catalog knows of a card, shown or retired; see `RetiredCard` for the nulls. */
export interface CardFacts {
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly prompt: string | null;
  readonly words: number | null;
}

/** The input length cap on a typed answer, which grading will read. */
const MAX_TEXT_LENGTH = 300;

/**
 * Whether `input` fits its round's mode: a typed round runs no timer, so it
 * has no timeout, and only a typed round carries text. A queued answer meets
 * the mode its round was dealt with, never the setting at replay time.
 */
function fitsMode(round: Round, input: AnswerInput): boolean {
  if (answerModeOf(round) === "spoken") {
    return input.text === undefined;
  }
  return (
    input.result !== "timeout" &&
    (input.text === undefined || input.text.length <= MAX_TEXT_LENGTH)
  );
}

/**
 * Refuses the whole batch when any answer names another round or an unknown
 * card, or does not fit its round's mode. A finished round refuses only a
 * batch carrying an id it does not hold, so a replayed batch stays safe after
 * finish.
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
      fitsMode(round, input),
  );
  return valid ? ok(undefined) : err({ code: "ERR_BAD_REQUEST" });
}
