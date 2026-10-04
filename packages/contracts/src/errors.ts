import * as z from "zod";

/**
 * Every `error.code` the API answers with, and the status each travels under.
 *
 * @remarks
 * Grouped by what a client can do. The caller must sign in again first:
 * `ERR_UNAUTHENTICATED`. The request itself is wrong and resending
 * it changes nothing: `ERR_BAD_REQUEST`, `ERR_PAYLOAD_TOO_LARGE`,
 * `ERR_FORBIDDEN`, `ERR_CARD_NOT_PERSONAL`, `ERR_ROUND_NOT_FOUND`,
 * `ERR_TALK_NOT_FOUND`, `ERR_SESSION_NOT_FOUND`, `ERR_CARD_NOT_FOUND`. The round, the day, the talk or the vocabulary
 * session has moved on, so reload before acting: `ERR_ROUND_CLOSED`,
 * `ERR_TALK_CLOSED`, `ERR_SESSION_CLOSED`. Another write kept winning, or the language model gave no
 * usable answer, so the same request may be sent again: `ERR_CONFLICT`,
 * `ERR_MODEL_UNAVAILABLE`. The server needs something first — cards dealt or
 * the catalog repaired: `ERR_NOT_ENOUGH_CARDS`, `ERR_CONTENT_UNREADABLE`.
 *
 * New codes may appear within `/v1`, which is why the envelope's
 * `code` is a string rather than this list as an enum: a client generated from
 * the document keeps a default branch instead of failing to decode.
 */
export const STATUS_BY_CODE = {
  ERR_BAD_REQUEST: 400,
  ERR_UNAUTHENTICATED: 401,
  ERR_FORBIDDEN: 403,
  ERR_CARD_NOT_PERSONAL: 403,
  ERR_ROUND_NOT_FOUND: 404,
  ERR_TALK_NOT_FOUND: 404,
  ERR_SESSION_NOT_FOUND: 404,
  ERR_CARD_NOT_FOUND: 404,
  ERR_ROUND_CLOSED: 409,
  ERR_TALK_CLOSED: 409,
  ERR_SESSION_CLOSED: 409,
  ERR_PAGED_SESSION_REQUIRED: 409,
  ERR_NOT_ENOUGH_CARDS: 409,
  ERR_CONFLICT: 409,
  ERR_PAYLOAD_TOO_LARGE: 413,
  ERR_CONTENT_UNREADABLE: 503,
  ERR_READ_MODEL_NOT_READY: 503,
  ERR_MODEL_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

/** One fixed sentence per code: a message never quotes what the request carried. */
export const MESSAGE_BY_CODE = {
  ERR_BAD_REQUEST:
    "The request does not fit the round, the talk, the settings or the profile it names.",
  ERR_UNAUTHENTICATED: "The request carries no valid access token.",
  ERR_FORBIDDEN: "The caller may not run this operation.",
  ERR_CARD_NOT_PERSONAL:
    "That card is the catalog's; only a card made from a talk can be deleted.",
  ERR_ROUND_NOT_FOUND: "No round has that id.",
  ERR_TALK_NOT_FOUND: "No talk has that id.",
  ERR_PAGED_SESSION_REQUIRED:
    "This session needs the paged vocabulary API. Reload the web client before starting.",
  ERR_SESSION_NOT_FOUND: "No vocabulary session has that id.",
  ERR_CARD_NOT_FOUND: "No vocabulary card of the learner's own has that id.",
  ERR_ROUND_CLOSED: "That round or day can no longer take this request.",
  ERR_TALK_CLOSED: "That talk has finished or ended and takes no more turns.",
  ERR_SESSION_CLOSED: "That vocabulary session has finished and takes no new answer.",
  ERR_NOT_ENOUGH_CARDS: "Too few reviewed cards can be dealt for a round.",
  ERR_CONFLICT: "Another write to the same data kept winning; send the request again.",
  ERR_PAYLOAD_TOO_LARGE: "The request body is too large.",
  ERR_CONTENT_UNREADABLE: "The card content could not be read.",
  ERR_READ_MODEL_NOT_READY:
    "The learner read model is being prepared; read again shortly.",
  ERR_MODEL_UNAVAILABLE:
    "The language model gave no usable answer; send the request again.",
} as const satisfies Record<ErrorCode, string>;

/** The body of every non-2xx answer. Clients branch on `code`, never on `message`. */
export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
