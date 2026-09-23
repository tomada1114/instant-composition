import type { CommitConflict } from "./store";

/**
 * The failures a command or query reports rather than throws.
 *
 * @remarks
 * Grouped by what a caller can do: `ERR_FORBIDDEN` means the actor may not run
 * the operation, and retrying changes nothing; `ERR_CONFLICT` means another
 * write kept winning the race, so the caller may send the same command again.
 */
export type ApplicationError = { readonly code: "ERR_FORBIDDEN" } | CommitConflict;

export type ApplicationErrorCode = ApplicationError["code"];
