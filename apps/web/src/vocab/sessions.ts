import {
  finishVocabSession,
  recordVocabAnswers,
  startVocabSession,
} from "../lib/vocab-endpoints";
import { err, type Result } from "../lib/result";
import type { ApiError, SendOutcome } from "../lib/endpoints";
import { TUNING } from "../lib/tuning";
import type {
  VocabAnswer,
  VocabCategory,
  VocabSession,
  VocabSessionKind,
  VocabSummary,
} from "../openapi";
import { flushEarlierRounds, sessionStore } from "../study/answer-queue";
import type { AnswerInput } from "../study/study-state";

export const VOCAB_QUEUE_PREFIX = "vocab-answers:";
export interface VocabSearch {
  readonly kind: VocabSessionKind;
  readonly category?: VocabCategory;
}
const CATEGORIES = ["word", "idiom", "phrasal-verb", "phrase"] as const;
/** Missing or unknown search values open today's queue across all categories. */
export function vocabSearch(search: Record<string, unknown>): VocabSearch {
  const kind =
    search["kind"] === "weak" || search["kind"] === "extra" ? search["kind"] : "today";
  const category = CATEGORIES.find((value) => value === search["category"]);
  return { kind, ...(category === undefined ? {} : { category }) };
}
function answerOf(answer: AnswerInput): VocabAnswer {
  return {
    id: answer.id,
    cardId: answer.cardId,
    pass: answer.pass,
    grade: answer.grade,
    elapsedMs: answer.elapsedMs,
    ...(answer.answeredAt === undefined ? {} : { answeredAt: answer.answeredAt }),
  };
}
/** Same stored representation as the drill, sent to the vocabulary session it belongs to. */
export function sendVocabAnswer(answer: AnswerInput): Promise<SendOutcome> {
  return recordVocabAnswers(answer.roundId, [answerOf(answer)]);
}
/** Resend old sessions before reading today's remaining queue; failed answers stay stored. */
export async function requestVocabSession(
  search: VocabSearch,
  sessionId: string,
): Promise<Result<VocabSession, ApiError>> {
  const empty = await flushEarlierRounds({
    currentId: sessionId,
    prefix: VOCAB_QUEUE_PREFIX,
    send: sendVocabAnswer,
    storage: sessionStore(),
  });
  return empty
    ? startVocabSession({ sessionId, ...search })
    : err({ code: "ERR_NETWORK" });
}
/** The finish carries the last pending batch; earlier batches stay within the contract bound. */
export async function requestVocabFinish(
  sessionId: string,
  pending: readonly AnswerInput[],
  notBefore = 0,
): Promise<Result<VocabSummary, ApiError>> {
  if (Date.now() < notBefore) return err({ code: "ERR_NETWORK", retryAt: notBefore });
  const size = TUNING.maxRoundAnswers;
  const answers = pending.map(answerOf);
  const last = Math.max(0, Math.ceil(answers.length / size) - 1) * size;
  for (let from = 0; from < last; from += size) {
    const sent = await recordVocabAnswers(sessionId, answers.slice(from, from + size));
    if (sent !== "sent")
      return err({
        code: "ERR_NETWORK",
        ...(typeof sent === "object" ? { retryAt: sent.retryAt } : {}),
      });
  }
  return finishVocabSession(sessionId, answers.slice(last));
}
