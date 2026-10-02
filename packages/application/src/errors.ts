import type { PracticeError, TalkError, VocabError } from "@instant-composition/domain";

import type { CatalogUnreadable } from "./catalog";
import type { ModelFailure } from "./language-model";
import type { CommitConflict } from "./store";

/**
 * The failures a command or query reports rather than throws.
 *
 * @remarks
 * Grouped by what a caller can do: `ERR_FORBIDDEN` means the actor may not run
 * the operation, and retrying changes nothing; `ERR_CONFLICT` means another
 * write kept winning the race, so the caller may send the same command again;
 * `ERR_CONTENT_UNREADABLE` needs the catalog repaired first. The practice rules'
 * own failures are `PracticeError`'s, and the vocabulary rules' `VocabError`'s.
 */
export type ApplicationError =
  | { readonly code: "ERR_FORBIDDEN" }
  | CommitConflict
  | CatalogUnreadable
  | PracticeError
  | VocabError;

export type ApplicationErrorCode = ApplicationError["code"];

/**
 * The failures a talk command reports: the application's own, the talk rules'
 * (`TalkError`), and `ERR_MODEL_UNAVAILABLE` when a scene or a reply could not
 * be had, which the caller may ask for again.
 *
 * @remarks
 * Kept apart from `ApplicationError`, so a drill command's failure type names
 * no talk code; `tests/contracts-schemas.test.ts` holds both inside the
 * contract's code list. A `ModelFailure`'s `reason` may reach a log, never a
 * response.
 */
export type TalkCommandError = ApplicationError | TalkError | ModelFailure;
