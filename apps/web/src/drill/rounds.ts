import {
  finishRound,
  recordAnswers,
  startRound,
  type ApiError,
  type SendOutcome,
} from "../lib/endpoints";
import { rememberFinishedRound } from "../lib/last-round";
import type { Result } from "../lib/result";
import type { Answer, RoundKind, RoundPayload, RoundSummary } from "../openapi";
import type { AnswerInput } from "./drill-state";

const ROUND_KINDS: readonly string[] = [
  "placement",
  "today",
  "yesterday",
  "extra",
] satisfies readonly RoundKind[];

/** The round kind a `?kind=` search value asks for; today's portion when it names none. */
export function roundKindFrom(value: unknown): RoundKind {
  return typeof value === "string" && ROUND_KINDS.includes(value)
    ? (value as RoundKind)
    : "today";
}

/**
 * Asks for a round of `kind` under a fresh id. The server resumes today's
 * open round instead when there is one, so the id to send answers under is
 * the one the answer carries, not the one asked with.
 */
export function requestRound(
  kind: RoundKind,
  roundId: string = crypto.randomUUID(),
): Promise<Result<RoundPayload, ApiError>> {
  return startRound({ roundId, kind });
}

/** The batch body's answer: the round travels in the path, not in the answer. */
function answerOf(input: AnswerInput): Answer {
  return {
    id: input.id,
    cardId: input.cardId,
    pass: input.pass,
    result: input.result,
    elapsedMs: input.elapsedMs,
  };
}

/** Finishes the round, and remembers it as the one the recap screen reads back. */
export async function requestFinish(
  roundId: string,
  answers: readonly AnswerInput[],
): Promise<Result<RoundSummary, ApiError>> {
  const finished = await finishRound(roundId, answers.map(answerOf));
  if (finished.ok) rememberFinishedRound(finished.value.roundId);
  return finished;
}

/** One answer, sent as a batch of one; the queue decides whether to send it again. */
export function sendAnswer(answer: AnswerInput): Promise<SendOutcome> {
  return recordAnswers(answer.roundId, [answerOf(answer)]);
}
