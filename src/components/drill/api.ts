import type { AnswerInput } from "../../core/api";
import { err, ok, type Result } from "../../core/result";
import type { RoundKind } from "../../core/types";
import type { RoundPayload, RoundSummary } from "../../core/views";
import type { SendOutcome } from "./answer-queue";

/** An error code from the API, or `ERR_NETWORK` when no readable answer came back. */
export interface ApiError {
  readonly code: string;
  readonly available?: number;
}

const NETWORK: ApiError = { code: "ERR_NETWORK" };

function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson<T>(request: Promise<Response>): Promise<Result<T, ApiError>> {
  try {
    const response = await request;
    const body = (await response.json()) as unknown;
    if (response.ok) return ok(body as T);
    const error = (body as { error?: ApiError } | null)?.error;
    return err(error?.code === undefined ? NETWORK : error);
  } catch {
    return err(NETWORK);
  }
}

export function requestRound(kind: RoundKind): Promise<Result<RoundPayload, ApiError>> {
  return readJson(post("/api/rounds", { kind }));
}

export function requestFinish(
  roundId: string,
  answers: readonly AnswerInput[],
): Promise<Result<RoundSummary, ApiError>> {
  return readJson(post("/api/rounds/finish", { roundId, answers }));
}

/** A 4xx means the server will never take this answer, so it is not resent. */
export async function sendAnswer(answer: AnswerInput): Promise<SendOutcome> {
  try {
    const response = await post("/api/answers", answer);
    if (response.ok) return "sent";
    return response.status < 500 ? "rejected" : "failed";
  } catch {
    return "failed";
  }
}
