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
