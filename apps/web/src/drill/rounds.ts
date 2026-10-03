import {
  finishRound,
  recordAnswers,
  startRound,
  type ApiError,
  type SendOutcome,
} from "../lib/endpoints";
import { err, type Result } from "../lib/result";
import { TUNING } from "../lib/tuning";
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

/**
 * The batch body's answer: the round travels in the path, not in the answer.
 * It never carries a text: every round is spoken.
 */
function answerOf(input: AnswerInput): Answer {
  return {
    id: input.id,
    cardId: input.cardId,
    pass: input.pass,
    grade: input.grade,
    timedOut: input.timedOut,
    elapsedMs: input.elapsedMs,
    ...(input.answeredAt === undefined ? {} : { answeredAt: input.answeredAt }),
  };
}

/**
 * Finishes the round, answering with the summary it keeps. `unrecorded` —
 * what the server may not hold yet — goes first in batches of at most
 * `TUNING.maxRoundAnswers`, the last batch with the finish itself; a batch
 * that fails stops it, and a resend is safe, each answer keeping its id.
 */
export async function requestFinish(
  roundId: string,
  unrecorded: readonly AnswerInput[],
): Promise<Result<RoundSummary, ApiError>> {
  const size = TUNING.maxRoundAnswers;
  const answers = unrecorded.map(answerOf);
  const last = Math.max(0, Math.ceil(answers.length / size) - 1) * size;
  for (let from = 0; from < last; from += size) {
    const sent = await recordAnswers(roundId, answers.slice(from, from + size));
    if (sent !== "sent") return err({ code: "ERR_NETWORK" });
  }
  return finishRound(roundId, answers.slice(last));
}

/** One answer, sent as a batch of one; the queue decides whether to send it again. */
export function sendAnswer(answer: AnswerInput): Promise<SendOutcome> {
  return recordAnswers(answer.roundId, [answerOf(answer)]);
}
