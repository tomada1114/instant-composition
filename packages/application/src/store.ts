import type {
  DayKey,
  DayTally,
  ItemProgress,
  ItemRef,
  LearnerStats,
  Portion,
  Result,
  ReviewEntry,
  Round,
  Settings,
} from "@instant-composition/domain";

import type { LearnerId } from "./context";

/** One record of a learner's data. Its key is derived from its value (`keyOf`). */
export type Entry =
  | { readonly type: "settings"; readonly value: Settings }
  | { readonly type: "stats"; readonly value: LearnerStats }
  | { readonly type: "round"; readonly value: Round }
  | { readonly type: "review"; readonly value: ReviewEntry }
  | { readonly type: "portion"; readonly value: Portion }
  | { readonly type: "day"; readonly value: DayTally }
  | { readonly type: "item"; readonly value: ItemProgress };

/** Where an entry lives inside the learner's own data; no key names a learner. */
export type Key =
  | { readonly type: "settings" }
  | { readonly type: "stats" }
  | { readonly type: "round"; readonly id: string }
  | { readonly type: "review"; readonly sessionId: string; readonly id: string }
  | { readonly type: "portion"; readonly day: DayKey }
  | { readonly type: "day"; readonly day: DayKey }
  | { readonly type: "item"; readonly item: ItemRef };

export function keyOf(entry: Entry): Key {
  switch (entry.type) {
    case "settings":
    case "stats":
      return { type: entry.type };
    case "round":
      return { type: "round", id: entry.value.id };
    case "review":
      return { type: "review", sessionId: entry.value.sessionId, id: entry.value.id };
    case "portion":
    case "day":
      return { type: entry.type, day: entry.value.day };
    case "item":
      return { type: "item", item: entry.value.item };
  }
}

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
 * of entries read but not written — a version, or `null` for "still absent".
 * Review entries are only ever put: the log is append-only.
 */
export interface Commit {
  readonly puts: readonly Entry[];
  readonly updates: readonly { readonly entry: Entry; readonly version: number }[];
  readonly expect: readonly { readonly key: Key; readonly version: number | null }[];
}

/** A condition of the commit no longer held, so nothing was written. */
export interface CommitConflict {
  readonly code: "ERR_CONFLICT";
}

/**
 * One learner's data, and nobody else's: no method takes a learner id, so no
 * caller can express a read or a write of another learner's entries.
 */
export interface LearnerStore {
  settings(): Promise<Stored<Settings> | undefined>;
  stats(): Promise<Stored<LearnerStats> | undefined>;
  round(id: string): Promise<Stored<Round> | undefined>;
  /** A session's reviews, ordered by `answeredAt` and then by id. */
  reviewsOf(sessionId: string): Promise<readonly ReviewEntry[]>;
  /** The whole review log in the same order, for rebuilding projections. */
  reviews(): Promise<readonly ReviewEntry[]>;
  portion(day: DayKey): Promise<Stored<Portion> | undefined>;
  /** The tallies of those `days` that have one. */
  days(days: readonly DayKey[]): Promise<ReadonlyMap<DayKey, Stored<DayTally>>>;
  /** Every item the learner has progress on, keyed by item id. */
  items(): Promise<ReadonlyMap<string, Stored<ItemProgress>>>;
  commit(commit: Commit): Promise<Result<undefined, CommitConflict>>;
}

/** The only way to a store: bound to the learner the request context names. */
export interface LearnerStores {
  forLearner(id: LearnerId): LearnerStore;
}
