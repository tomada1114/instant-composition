import type { Route } from "./routes";
import { startVocabSessionRequestSchema } from "./vocab";
import {
  vocabPageRequestSchema,
  vocabPreparationSchema,
  vocabPageSchema,
  vocabPagedAnswersRequestSchema,
  vocabPagedSummarySchema,
} from "./vocab-pages";

const ERRORS = [
  "ERR_BAD_REQUEST",
  "ERR_PAYLOAD_TOO_LARGE",
  "ERR_UNAUTHENTICATED",
  "ERR_FORBIDDEN",
  "ERR_CONFLICT",
  "ERR_CONTENT_UNREADABLE",
  "ERR_SESSION_NOT_FOUND",
  "ERR_SESSION_CLOSED",
  "ERR_READ_MODEL_NOT_READY",
] as const;

/** Explicit opt-in avoids giving an old client a truncated logical deck. */
export const VOCAB_PAGED_ROUTES: readonly Route[] = [
  {
    method: "post",
    path: "/v1/vocab/paged-sessions",
    operationId: "startPagedVocabSession",
    summary:
      "Creates or resumes a logical session's bounded preparation checkpoint. No cards are studied before preparation is ready.",
    requestBody: startVocabSessionRequestSchema,
    success: { status: 200, body: vocabPreparationSchema },
    errors: ERRORS,
  },
  {
    method: "post",
    path: "/v1/vocab/paged-sessions/{sessionId}/prepare",
    operationId: "preparePagedVocabSession",
    summary:
      "Copies at most one immutable deck page. A changed source restarts preparation under a fresh generation, before study begins.",
    requestBody: null,
    success: { status: 200, body: vocabPreparationSchema },
    errors: ERRORS,
  },
  {
    method: "post",
    path: "/v1/vocab/paged-sessions/{sessionId}/page",
    operationId: "getPagedVocabPage",
    summary:
      "Reads one immutable prepared page using its stable continuation. Empty pages retain continuation; only null marks deck EOF.",
    requestBody: vocabPageRequestSchema,
    success: { status: 200, body: vocabPageSchema },
    errors: ERRORS,
  },
  {
    method: "post",
    path: "/v1/vocab/paged-sessions/{sessionId}/answers",
    operationId: "recordPagedVocabAnswers",
    summary:
      "Records bounded answers proven by immutable page membership, updating small adoption checkpoints and the logical session guard without rewriting deck pages.",
    requestBody: vocabPagedAnswersRequestSchema,
    success: { status: 204, body: null },
    errors: ERRORS,
  },
  {
    method: "post",
    path: "/v1/vocab/paged-sessions/{sessionId}/finish",
    operationId: "finishPagedVocabSession",
    summary:
      "Saves pending answers and closes the logical session after all pages and re-asks. Counts cover the whole session; again rows are a bounded preview.",
    requestBody: vocabPagedAnswersRequestSchema,
    success: { status: 200, body: vocabPagedSummarySchema },
    errors: ERRORS,
  },
];
