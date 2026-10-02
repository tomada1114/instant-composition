/**
 * The failures a practice rule reports rather than throws.
 *
 * @remarks
 * Grouped by what a caller can do: `ERR_BAD_REQUEST` and `ERR_ROUND_NOT_FOUND`
 * are the caller's mistake; `ERR_ROUND_CLOSED` means the round or the day has
 * moved on, so the caller should reload; `ERR_NOT_ENOUGH_CARDS` needs cards
 * generated or reviewed first.
 */
export type PracticeError =
  | { readonly code: "ERR_BAD_REQUEST" }
  | { readonly code: "ERR_ROUND_NOT_FOUND" }
  | { readonly code: "ERR_ROUND_CLOSED" }
  | { readonly code: "ERR_NOT_ENOUGH_CARDS"; readonly available: number };

/**
 * The failures a talk rule reports rather than throws.
 *
 * @remarks
 * Grouped by what a caller can do: `ERR_BAD_REQUEST` (a field out of bounds, or
 * English holding a Japanese character) and `ERR_TALK_NOT_FOUND` (unknown,
 * expired, or another learner's) are the caller's mistake; `ERR_CONFLICT` means
 * the step asked for is not the next one, so the caller should do that one
 * first; `ERR_TALK_CLOSED` means the talk has finished or ended and takes no
 * more turns.
 */
export type TalkError =
  | { readonly code: "ERR_BAD_REQUEST" }
  | { readonly code: "ERR_CONFLICT" }
  | { readonly code: "ERR_TALK_NOT_FOUND" }
  | { readonly code: "ERR_TALK_CLOSED" };

/**
 * The failures a vocabulary rule reports rather than throws.
 *
 * @remarks
 * Grouped by what a caller can do: `ERR_BAD_REQUEST` (a card the session did
 * not deal), `ERR_SESSION_NOT_FOUND` and `ERR_CARD_NOT_FOUND` (unknown, or
 * another learner's) and `ERR_CARD_NOT_PERSONAL` (a catalog card, which no
 * learner deletes) are the caller's mistake; `ERR_SESSION_CLOSED` means the
 * session has finished and takes no new answer, so the caller should start
 * another.
 */
export type VocabError =
  | { readonly code: "ERR_BAD_REQUEST" }
  | { readonly code: "ERR_SESSION_NOT_FOUND" }
  | { readonly code: "ERR_SESSION_CLOSED" }
  | { readonly code: "ERR_CARD_NOT_FOUND" }
  | { readonly code: "ERR_CARD_NOT_PERSONAL" };
