import * as z from "zod";

/**
 * Every `error.code` the API answers with, and the status each travels under.
 *
 * @remarks
 * Grouped by what a client can do. The request itself is wrong and resending
 * it changes nothing: `ERR_BAD_REQUEST`, `ERR_PAYLOAD_TOO_LARGE`,
 * `ERR_FORBIDDEN`, `ERR_ROUND_NOT_FOUND`. The round or the day has moved on, so
 * reload before acting: `ERR_ROUND_CLOSED`. Another write kept winning, so the
 * same request may be sent again: `ERR_CONFLICT`. The server needs something
 * first — cards dealt or the catalog repaired: `ERR_NOT_ENOUGH_CARDS`,
 * `ERR_CONTENT_UNREADABLE`.
 *
 * New codes may appear within `/v1` (ADR-0007), which is why the envelope's
 * `code` is a string rather than this list as an enum: a client generated from
 * the document keeps a default branch instead of failing to decode.
 */
export const STATUS_BY_CODE = {
  ERR_BAD_REQUEST: 400,
  ERR_FORBIDDEN: 403,
  ERR_ROUND_NOT_FOUND: 404,
  ERR_ROUND_CLOSED: 409,
  ERR_NOT_ENOUGH_CARDS: 409,
  ERR_CONFLICT: 409,
  ERR_PAYLOAD_TOO_LARGE: 413,
  ERR_CONTENT_UNREADABLE: 503,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

/** One fixed sentence per code: a message never quotes what the request carried. */
export const MESSAGE_BY_CODE = {
  ERR_BAD_REQUEST: "The request does not fit the round or the settings it names.",
  ERR_FORBIDDEN: "The caller may not run this operation.",
  ERR_ROUND_NOT_FOUND: "No round has that id.",
  ERR_ROUND_CLOSED: "That round or day can no longer take this request.",
  ERR_NOT_ENOUGH_CARDS: "Too few reviewed cards can be dealt for a round.",
  ERR_CONFLICT: "Another write to the same data kept winning; send the request again.",
  ERR_PAYLOAD_TOO_LARGE: "The request body is too large.",
  ERR_CONTENT_UNREADABLE: "The card content could not be read.",
} as const satisfies Record<ErrorCode, string>;

/** The body of every non-2xx answer. Clients branch on `code`, never on `message`. */
export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
