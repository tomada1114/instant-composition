import type {
  DeleteVocabCardData,
  DeleteVocabCardResponses,
  FinishVocabSessionData,
  FinishVocabSessionResponses,
  GetVocabData,
  GetVocabResponses,
  RecordVocabAnswersData,
  StartVocabSessionData,
  StartVocabSessionRequest,
  StartVocabSessionResponses,
  VocabAnswer,
  VocabHub,
  VocabSession,
  VocabSummary,
} from "../openapi";
import { call, errorCode, send, type ApiError, type SendOutcome } from "./api-call";
import { err, ok, type Result } from "./result";

/** The vocabulary queue, categories and tomorrow's due count. */
export function getVocab(): Promise<Result<VocabHub, ApiError>> {
  return call<GetVocabResponses>("GET", { url: "/v1/vocab" } satisfies GetVocabData);
}

/** A fresh session; repeating its request id returns the same dealt cards. */
export function startVocabSession(
  request: StartVocabSessionRequest,
): Promise<Result<VocabSession, ApiError>> {
  return call<StartVocabSessionResponses>("POST", {
    url: "/v1/vocab/sessions",
    body: request,
  } satisfies StartVocabSessionData);
}

/** A closed session's complete summary, including answers not previously saved. */
export function finishVocabSession(
  sessionId: string,
  answers: readonly VocabAnswer[],
): Promise<Result<VocabSummary, ApiError>> {
  return call<FinishVocabSessionResponses>("POST", {
    url: "/v1/vocab/sessions/{sessionId}/finish",
    path: { sessionId },
    body: { answers: [...answers] },
  } satisfies FinishVocabSessionData);
}

/** Only network, server and conflict failures remain queued for resend. */
export async function recordVocabAnswers(
  sessionId: string,
  answers: readonly VocabAnswer[],
): Promise<SendOutcome> {
  const data = {
    url: "/v1/vocab/sessions/{sessionId}/answers",
    path: { sessionId },
    body: { answers: [...answers] },
  } satisfies RecordVocabAnswersData;
  try {
    const response = await send("POST", data);
    if (response.ok) return "sent";
    if (response.status >= 500) return "failed";
    return errorCode(await response.json().catch(() => null)) === "ERR_CONFLICT"
      ? "failed"
      : "rejected";
  } catch {
    return "failed";
  }
}

/** Deletes an owned card and its progress, accepting the contract's bodyless 204. */
export async function deleteVocabCard(
  cardId: string,
): Promise<Result<DeleteVocabCardResponses[204], ApiError>> {
  try {
    const response = await send("DELETE", {
      url: "/v1/vocab/cards/{cardId}",
      path: { cardId },
    } satisfies DeleteVocabCardData);
    if (response.status === 204) return ok(undefined);
    return err({ code: errorCode(await response.json()) ?? "ERR_NETWORK" });
  } catch {
    return err({ code: "ERR_NETWORK" });
  }
}
