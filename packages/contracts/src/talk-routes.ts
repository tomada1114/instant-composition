import type { Route } from "./routes";
import {
  addCardsRequestSchema,
  cardCandidatesSchema,
  partnerReplySchema,
  recitalRequestSchema,
  startTalkRequestSchema,
  talkEndedSchema,
  talkOpenedSchema,
  turnRequestSchema,
  turnResultSchema,
} from "./talk";

/**
 * A talk operation names a signed-in caller's own talk, by a `{talkId}` validated
 * like a body field, and commits conditionally; an unknown, expired or another
 * learner's talk is not found.
 */
const TALK_ERRORS = [
  "ERR_BAD_REQUEST",
  "ERR_UNAUTHENTICATED",
  "ERR_FORBIDDEN",
  "ERR_CONFLICT",
  "ERR_TALK_NOT_FOUND",
] as const;

/** The talk activity's `/v1` operations; the talk context's commands back them. */
export const TALK_ROUTES: readonly Route[] = [
  {
    method: "post",
    path: "/v1/talks",
    operationId: "startTalk",
    summary:
      "Starts a talk: one model call makes the scene and the partner's opening line. A retried start with the same talkId answers the talk it made without calling the model.",
    requestBody: startTalkRequestSchema,
    success: { status: 200, body: talkOpenedSchema },
    errors: [
      "ERR_BAD_REQUEST",
      "ERR_PAYLOAD_TOO_LARGE",
      "ERR_UNAUTHENTICATED",
      "ERR_FORBIDDEN",
      "ERR_CONFLICT",
      "ERR_MODEL_UNAVAILABLE",
    ],
  },
  {
    method: "post",
    path: "/v1/talks/{talkId}/turns",
    operationId: "sendTurn",
    summary:
      "Keeps the next turn, judged by the teacher and answered by the partner in parallel: a teacher that answered nothing keeps the verdict failed, a partner that answered nothing keeps reply null. A resent kept turn answers as kept, without a model call; any turn but the next is ERR_CONFLICT.",
    requestBody: turnRequestSchema,
    success: { status: 200, body: turnResultSchema },
    errors: [...TALK_ERRORS, "ERR_PAYLOAD_TOO_LARGE", "ERR_TALK_CLOSED"],
  },
  {
    method: "post",
    path: "/v1/talks/{talkId}/reply",
    operationId: "retryReply",
    summary:
      "Asks the partner again for the latest turn's reply, once a turn was kept without one; a reply already kept is answered without a model call.",
    requestBody: null,
    success: { status: 200, body: partnerReplySchema },
    errors: [...TALK_ERRORS, "ERR_TALK_CLOSED", "ERR_MODEL_UNAVAILABLE"],
  },
  {
    method: "post",
    path: "/v1/talks/{talkId}/turns/{turn}/recital",
    operationId: "recordRecital",
    summary:
      "Keeps how often the learner looked at a kept turn's model answer again while reciting it; sending the same count again writes nothing.",
    requestBody: recitalRequestSchema,
    success: { status: 204, body: null },
    errors: [...TALK_ERRORS, "ERR_PAYLOAD_TOO_LARGE"],
  },
  {
    method: "post",
    path: "/v1/talks/{talkId}/end",
    operationId: "endTalk",
    summary:
      "Ends the talk: kept as a record when it holds a turn, discarded to expire when it holds none. Ending it again answers the same kept.",
    requestBody: null,
    success: { status: 200, body: talkEndedSchema },
    errors: TALK_ERRORS,
  },
  {
    method: "post",
    path: "/v1/talks/{talkId}/candidates",
    operationId: "makeCandidates",
    summary:
      "The vocabulary card candidates at a kept talk's end, at most one per corrected turn: one model call, its answer kept on the talk, so a resend answers the same candidates without a call. A talk with no corrected turn answers none without a call; one still open is ERR_CONFLICT. A candidate whose headword a catalog card, or one of the learner's own, holds is answered as that card.",
    requestBody: null,
    success: { status: 200, body: cardCandidatesSchema },
    errors: [...TALK_ERRORS, "ERR_CONTENT_UNREADABLE", "ERR_MODEL_UNAVAILABLE"],
  },
  {
    method: "post",
    path: "/v1/talks/{talkId}/cards",
    operationId: "addCards",
    summary:
      "Adds the picked candidates to the learner's vocabulary, as new and weak cards: a matched card is marked as from the talk and kept as it stands, any other becomes a personal card. A candidate already added is not added again. Answers the candidates as they now stand; before the candidates were made it is ERR_CONFLICT, and an index past the list ERR_BAD_REQUEST.",
    requestBody: addCardsRequestSchema,
    success: { status: 200, body: cardCandidatesSchema },
    errors: [...TALK_ERRORS, "ERR_PAYLOAD_TOO_LARGE", "ERR_CONTENT_UNREADABLE"],
  },
];
