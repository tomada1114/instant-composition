import type { ContentSource } from "../content";
import type { ProgressStore } from "../db";

export interface ServiceDeps {
  readonly store: ProgressStore;
  readonly content: ContentSource;
  readonly now: () => number;
  readonly newId: () => string;
}

/**
 * The failures a service reports rather than throws.
 *
 * @remarks
 * Grouped by what a caller can do: `ERR_BAD_REQUEST` and `ERR_ROUND_NOT_FOUND`
 * are the caller's mistake; `ERR_ROUND_CLOSED` means the round or the day has
 * moved on, so the caller should reload; `ERR_NOT_ENOUGH_CARDS` and
 * `ERR_CONTENT_UNREADABLE` need cards generated, reviewed or repaired first.
 */
export type ServiceError =
  | { readonly code: "ERR_BAD_REQUEST" }
  | { readonly code: "ERR_ROUND_NOT_FOUND" }
  | { readonly code: "ERR_ROUND_CLOSED" }
  | { readonly code: "ERR_NOT_ENOUGH_CARDS"; readonly available: number }
  | { readonly code: "ERR_CONTENT_UNREADABLE" };

export type ServiceErrorCode = ServiceError["code"];
