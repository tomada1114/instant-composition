import type { Entry, Key } from "./store-entry";

/** A value as read, with the version a later commit names to say "unchanged since". */
export interface Stored<T> {
  readonly value: T;
  readonly version: number;
}

/**
 * Everything one command writes, applied whole or not at all.
 *
 * @remarks
 * `puts` create entries that must not exist yet; `updates` replace entries
 * still at the version they were read at; `expect` states what must still hold
 * of entries read but not written — a version, or `null` for "still absent";
 * `deletes` remove entries still at the version they were read at. Review
 * entries, the drill's and the vocabulary's, are only ever put: the logs are
 * append-only, and no commit updates or deletes one.
 */
export interface Commit {
  /** A source-changing commit may guard the automatically incremented source version. */
  readonly readModelSourceVersion?: number | null;
  readonly compositionSourceVersion?: number | null;
  readonly puts: readonly Entry[];
  readonly updates: readonly {
    readonly entry: Entry;
    readonly version: number;
    readonly modelClaim?: string;
  }[];
  readonly expect: readonly { readonly key: Key; readonly version: number | null }[];
  /** Absent for a commit that deletes nothing, which is nearly every one. */
  readonly deletes?: readonly { readonly key: Key; readonly version: number }[];
}

/** A condition of the commit no longer held, so nothing was written. */
export interface CommitConflict {
  readonly code: "ERR_CONFLICT";
}
