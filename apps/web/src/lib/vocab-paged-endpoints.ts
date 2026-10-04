import type {
  StartPagedVocabSessionData,
  StartPagedVocabSessionResponses,
  StartVocabSessionRequest,
  PreparePagedVocabSessionData,
  PreparePagedVocabSessionResponses,
  GetPagedVocabPageData,
  GetPagedVocabPageResponses,
  RecordPagedVocabAnswersData,
  FinishPagedVocabSessionData,
  FinishPagedVocabSessionResponses,
  VocabPagedAnswer,
  VocabPage,
  VocabPreparation,
  VocabPagedSummary,
} from "../openapi";
import { call, type ApiError, type SendOutcome } from "./api-call";
import { sendAnswerBatch } from "./answer-send";
import type { Result } from "./result";

export function startPagedVocabSession(
  request: StartVocabSessionRequest,
): Promise<Result<VocabPreparation, ApiError>> {
  return call<StartPagedVocabSessionResponses>("POST", {
    url: "/v1/vocab/paged-sessions",
    body: request,
  } satisfies StartPagedVocabSessionData);
}
export function preparePagedVocabSession(
  sessionId: string,
): Promise<Result<VocabPreparation, ApiError>> {
  return call<PreparePagedVocabSessionResponses>("POST", {
    url: "/v1/vocab/paged-sessions/{sessionId}/prepare",
    path: { sessionId },
  } satisfies PreparePagedVocabSessionData);
}
export function getPagedVocabPage(
  sessionId: string,
  cursor: string | null,
  retained?: readonly { readonly page: number; readonly cardId: string }[],
): Promise<Result<VocabPage, ApiError>> {
  return call<GetPagedVocabPageResponses>("POST", {
    url: "/v1/vocab/paged-sessions/{sessionId}/page",
    path: { sessionId },
    body: { cursor, ...(retained === undefined ? {} : { retained: [...retained] }) },
  } satisfies GetPagedVocabPageData);
}
export function recordPagedVocabAnswers(
  sessionId: string,
  generation: number,
  answers: readonly VocabPagedAnswer[],
): Promise<SendOutcome> {
  return sendAnswerBatch(
    {
      url: "/v1/vocab/paged-sessions/{sessionId}/answers",
      path: { sessionId },
      body: { generation, answers: [...answers] },
    } satisfies RecordPagedVocabAnswersData,
    {
      ERR_BAD_REQUEST: 400,
      ERR_PAYLOAD_TOO_LARGE: 413,
      ERR_FORBIDDEN: 403,
      ERR_SESSION_NOT_FOUND: 404,
      ERR_SESSION_CLOSED: 409,
    },
  );
}
export function finishPagedVocabSession(
  sessionId: string,
  generation: number,
  answers: readonly VocabPagedAnswer[],
): Promise<Result<VocabPagedSummary, ApiError>> {
  return call<FinishPagedVocabSessionResponses>("POST", {
    url: "/v1/vocab/paged-sessions/{sessionId}/finish",
    path: { sessionId },
    body: { generation, answers: [...answers] },
  } satisfies FinishPagedVocabSessionData);
}
