import type { Route } from "./routes";
import {
  startVocabSessionRequestSchema,
  vocabAnswersRequestSchema,
  vocabHubSchema,
  vocabSessionSchema,
  vocabSummarySchema,
} from "./vocab";

/** A command on a session reads a body and its `{sessionId}`, and commits conditionally. */
const SESSION_ERRORS = [
  "ERR_BAD_REQUEST",
  "ERR_PAYLOAD_TOO_LARGE",
  "ERR_UNAUTHENTICATED",
  "ERR_FORBIDDEN",
  "ERR_CONFLICT",
  "ERR_CONTENT_UNREADABLE",
  "ERR_SESSION_NOT_FOUND",
  "ERR_SESSION_CLOSED",
] as const;

/**
 * The vocabulary activity's `/v1` operations. A session id names the
 * signed-in caller's own session; an unknown one, or another learner's, is
 * not found.
 */
export const VOCAB_ROUTES: readonly Route[] = [
  {
    method: "get",
    path: "/v1/vocab",
    operationId: "getVocab",
    summary:
      "The vocabulary hub: today's reviews and new cards and the minutes they take, each category's share of them with its cards in learning and in all, the weak cards and tomorrow's reviews.",
    requestBody: null,
    success: { status: 200, body: vocabHubSchema },
    errors: ["ERR_UNAUTHENTICATED", "ERR_FORBIDDEN", "ERR_CONTENT_UNREADABLE"],
  },
  {
    method: "post",
    path: "/v1/vocab/sessions",
    operationId: "startVocabSession",
    summary:
      "Deals a session of today's queue, the extra cards past it or the weak cards, restricted to a category when one is named, and answers its cards in order, each with the interval every grade would set; a retried start with the same sessionId answers the session it made.",
    requestBody: startVocabSessionRequestSchema,
    success: { status: 200, body: vocabSessionSchema },
    errors: [
      "ERR_BAD_REQUEST",
      "ERR_PAYLOAD_TOO_LARGE",
      "ERR_UNAUTHENTICATED",
      "ERR_FORBIDDEN",
      "ERR_CONFLICT",
      "ERR_CONTENT_UNREADABLE",
    ],
  },
  {
    method: "post",
    path: "/v1/vocab/sessions/{sessionId}/answers",
    operationId: "recordVocabAnswers",
    summary:
      "Records a batch of a session's answers; ids it already holds are ignored, so a batch of those alone answers 204 even after finish, and one with a new id for a finished session answers ERR_SESSION_CLOSED. Only a card's first answer of the session's day moves its schedule.",
    requestBody: vocabAnswersRequestSchema,
    success: { status: 204, body: null },
    errors: SESSION_ERRORS,
  },
  {
    method: "post",
    path: "/v1/vocab/sessions/{sessionId}/finish",
    operationId: "finishVocabSession",
    summary:
      "Records the session's last answers and closes it, answering the done summary; a finished session answers the summary it kept.",
    requestBody: vocabAnswersRequestSchema,
    success: { status: 200, body: vocabSummarySchema },
    errors: SESSION_ERRORS,
  },
];
