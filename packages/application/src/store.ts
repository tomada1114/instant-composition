import type {
  DayKey,
  DayTally,
  ItemProgress,
  ItemRef,
  LearnerStats,
  PersonalCard,
  Portion,
  Result,
  ReviewEntry,
  Round,
  Settings,
  Talk,
  VocabProgress,
  VocabReview,
  VocabSession,
} from "@instant-composition/domain";

import type { LearnerId, Profile } from "./context";

/** One record of a learner's data. Its key is derived from its value (`keyOf`). */
export type Entry =
  | { readonly type: "profile"; readonly value: Profile }
  | { readonly type: "settings"; readonly value: Settings }
  | { readonly type: "stats"; readonly value: LearnerStats }
  | { readonly type: "round"; readonly value: Round }
  | { readonly type: "review"; readonly value: ReviewEntry }
  | { readonly type: "portion"; readonly value: Portion }
  | { readonly type: "day"; readonly value: DayTally }
  | { readonly type: "item"; readonly value: ItemProgress }
  | { readonly type: "talk"; readonly value: Talk }
  | { readonly type: "vocabItem"; readonly value: VocabProgress }
  | { readonly type: "vocabSession"; readonly value: VocabSession }
  | { readonly type: "vocabReview"; readonly value: VocabReview }
  | { readonly type: "card"; readonly value: PersonalCard };

/** Where an entry lives inside the learner's own data; no key names a learner. */
export type Key =
  | { readonly type: "profile" }
  | { readonly type: "settings" }
  | { readonly type: "stats" }
  | { readonly type: "round"; readonly id: string }
  | { readonly type: "review"; readonly sessionId: string; readonly id: string }
  | { readonly type: "portion"; readonly day: DayKey }
  | { readonly type: "day"; readonly day: DayKey }
  | { readonly type: "item"; readonly item: ItemRef }
  | { readonly type: "talk"; readonly id: string }
  | { readonly type: "vocabItem"; readonly cardId: string }
  | { readonly type: "vocabSession"; readonly id: string }
  | { readonly type: "vocabReview"; readonly sessionId: string; readonly id: string }
  | { readonly type: "card"; readonly id: string };

export function keyOf(entry: Entry): Key {
  switch (entry.type) {
    case "profile":
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
    case "talk":
    case "vocabSession":
    case "card":
      return { type: entry.type, id: entry.value.id };
    case "vocabItem":
      return { type: "vocabItem", cardId: entry.value.cardId };
    case "vocabReview":
      return {
        type: "vocabReview",
        sessionId: entry.value.sessionId,
        id: entry.value.id,
      };
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
 * of entries read but not written — a version, or `null` for "still absent";
 * `deletes` remove entries still at the version they were read at. Review
 * entries, the drill's and the vocabulary's, are only ever put: the logs are
 * append-only, and no commit updates or deletes one.
 */
export interface Commit {
  readonly puts: readonly Entry[];
  readonly updates: readonly { readonly entry: Entry; readonly version: number }[];
  readonly expect: readonly { readonly key: Key; readonly version: number | null }[];
  /** Absent for a commit that deletes nothing, which is nearly every one. */
  readonly deletes?: readonly { readonly key: Key; readonly version: number }[];
}

/** A condition of the commit no longer held, so nothing was written. */
export interface CommitConflict {
  readonly code: "ERR_CONFLICT";
}

/** A bounded page in storage-key order, used only to initialize legacy adoption. */
export interface ReviewPage {
  readonly entries: readonly ReviewEntry[];
  /** The last storage key, or null when the log has no next page. */
  readonly cursor: string | null;
}

/**
 * One learner's data, and nobody else's: no method takes a learner id, so no
 * caller can express a read or a write of another learner's entries.
 */
export interface LearnerStore {
  /** The profile the learner directory wrote at registration, as changed since. */
  profile(): Promise<Stored<Profile> | undefined>;
  settings(): Promise<Stored<Settings> | undefined>;
  stats(): Promise<Stored<LearnerStats> | undefined>;
  round(id: string): Promise<Stored<Round> | undefined>;
  /** A session's reviews, ordered by `answeredAt` and then by id. */
  reviewsOf(sessionId: string): Promise<readonly ReviewEntry[]>;
  /** Only the named answer ids of this round, without reading its other answers. */
  reviewsByIds(
    sessionId: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<ReviewEntry>>>;
  /** At most 32 legacy log entries; cursor is opaque and bound to this round. */
  reviewPage(sessionId: string, cursor: string | null): Promise<ReviewPage>;
  /** The whole review log in the same order, for rebuilding projections. */
  reviews(): Promise<readonly ReviewEntry[]>;
  portion(day: DayKey): Promise<Stored<Portion> | undefined>;
  /** The tallies of those `days` that have one. */
  days(days: readonly DayKey[]): Promise<ReadonlyMap<DayKey, Stored<DayTally>>>;
  /** Every item the learner has progress on, keyed by item id. */
  items(): Promise<ReadonlyMap<string, Stored<ItemProgress>>>;
  /** Only progress for the named composition cards. */
  itemsByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<ItemProgress>>>;
  /**
   * The talk with that id, as stored: one past its `expiresAt` is still
   * returned until the table's TTL deletes it, so a command reads it through
   * the domain's `liveTalk`.
   */
  talk(id: string): Promise<Stored<Talk> | undefined>;
  /** Every vocabulary card the learner has progress on, keyed by card id. */
  vocabItems(): Promise<ReadonlyMap<string, Stored<VocabProgress>>>;
  /** Only progress for the named vocabulary cards. */
  vocabItemsByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<VocabProgress>>>;
  vocabSession(id: string): Promise<Stored<VocabSession> | undefined>;
  /** A vocabulary session's answers, ordered by `answeredAt` and then by id. */
  vocabReviewsOf(sessionId: string): Promise<readonly VocabReview[]>;
  /** Only the named answer ids of this vocabulary session. */
  vocabReviewsByIds(
    sessionId: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<VocabReview>>>;
  /** One of the learner's personal vocabulary cards. */
  card(id: string): Promise<Stored<PersonalCard> | undefined>;
  /** Every personal vocabulary card the learner has, keyed by id. */
  cards(): Promise<ReadonlyMap<string, Stored<PersonalCard>>>;
  /** Only personal cards with the named ids, in this learner's partition. */
  cardsByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<PersonalCard>>>;
  commit(commit: Commit): Promise<Result<undefined, CommitConflict>>;
}

/** The only way to a store: bound to the learner the request context names. */
export interface LearnerStores {
  forLearner(id: LearnerId): LearnerStore;
}
