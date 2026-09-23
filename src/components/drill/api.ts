import { roundKindSchema, type AnswerInput } from "../../core/api";
import type { Result } from "../../core/result";
import type { RoundKind } from "../../core/types";
import type { RoundPayload, RoundSummary } from "../../core/views";
import { readJson, sendJson, type ApiError } from "../lib/api";
import type { SendOutcome } from "./answer-queue";

export type { ApiError } from "../lib/api";

export function requestRound(kind: RoundKind): Promise<Result<RoundPayload, ApiError>> {
  return readJson(sendJson("/api/rounds", { kind }));
}

export function requestFinish(
  roundId: string,
  answers: readonly AnswerInput[],
): Promise<Result<RoundSummary, ApiError>> {
  return readJson(sendJson("/api/rounds/finish", { roundId, answers }));
}

/** A 4xx means the server will never take this answer, so it is not resent. */
export async function sendAnswer(answer: AnswerInput): Promise<SendOutcome> {
  try {
    const response = await sendJson("/api/answers", answer);
    if (response.ok) return "sent";
    return response.status < 500 ? "rejected" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * The round kind a `?kind=` query asks for; today's portion when it names
 * none. Read in the browser, because the locale layout renders statically
 * and hands a page no search parameters.
 */
export function roundKindFrom(search: string): RoundKind {
  const parsed = roundKindSchema.safeParse(new URLSearchParams(search).get("kind"));
  return parsed.success ? parsed.data : "today";
}
