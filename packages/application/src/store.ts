import type { Stored, Commit, CommitConflict } from "./store-commit";
export type { Stored, Commit, CommitConflict } from "./store-commit";
import { type VocabPagedStore } from "./vocab-page-store";
import type {
  DayKey,
  DayTally,
  ItemProgress,
  LearnerStats,
  ModelTask,
  ModelTaskKey,
  PersonalCard,
  Portion,
  Result,
  ReviewEntry,
  Round,
  Settings,
  StreakRun,
  Talk,
  VocabProgress,
  VocabReview,
  VocabSession,
} from "@instant-composition/domain";
import type {
  CompositionBuild,
  CompositionReadModel,
  CompositionSource,
  ItemPageRequest,
  PortionRange,
  StorePage,
  StreakMigration,
} from "./composition-model";
import type {
  CandidatePage,
  CandidatePageRequest,
  PersonalCardPage,
  ReadModelSource,
  VocabCandidate,
  VocabReadModel,
  VocabReadModelRequest,
  VocabReadModelRequestPage,
} from "./read-model";
import type { LearnerId, Profile } from "./context";
import type {
  CompositionCandidate,
  CompositionCandidateRequest,
} from "./composition-candidate";
export { keyOf, type Entry, type Key } from "./store-entry";

/**
 * One learner's data, and nobody else's: no method takes a learner id, so no
 * caller can express a read or a write of another learner's entries.
 */
export interface LearnerStore extends VocabPagedStore {
  reviewsByIds(
    sessionId: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<ReviewEntry>>>;
  reviewPage(sessionId: string, cursor: string | null): Promise<ReviewPage>;
  compositionCandidates(request: CompositionCandidateRequest): Promise<{
    readonly rows: readonly Stored<CompositionCandidate>[];
    readonly cursor: string | null;
  }>;
  compositionCandidatesByKeys(
    candidates: readonly CompositionCandidate[],
  ): Promise<ReadonlyMap<string, Stored<CompositionCandidate>>>;
  compositionSource(): Promise<Stored<CompositionSource> | undefined>;
  compositionReadModel(day: DayKey): Promise<Stored<CompositionReadModel> | undefined>;
  compositionBuild(day: DayKey): Promise<Stored<CompositionBuild> | undefined>;
  streakMigration(): Promise<Stored<StreakMigration> | undefined>;
  /** At most the immediately preceding and following interval, strongly consistent. */
  streakNeighbours(day: DayKey): Promise<readonly Stored<StreakRun>[]>;
  /** Strong primary-key range; the opaque cursor is bound to this learner and range. */
  portionsPage(range: PortionRange): Promise<StorePage<Portion>>;
  /** Explicit maintenance only; screens never traverse these pages. */
  compositionItemsPage(request: ItemPageRequest): Promise<StorePage<ItemProgress>>;
  /** The profile the learner directory wrote at registration, as changed since. */
  profile(): Promise<Stored<Profile> | undefined>;
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
  talk(id: string): Promise<Stored<Talk> | undefined>;
  modelTask(task: ModelTaskKey): Promise<Stored<ModelTask> | undefined>;
  /** Every vocabulary card the learner has progress on, keyed by card id. */
  vocabItems(): Promise<ReadonlyMap<string, Stored<VocabProgress>>>;
  vocabSession(id: string): Promise<Stored<VocabSession> | undefined>;
  /** A vocabulary session's answers, ordered by `answeredAt` and then by id. */
  vocabReviewsOf(sessionId: string): Promise<readonly VocabReview[]>;
  vocabReviewsByIds(
    sessionId: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<VocabReview>>>;
  /** One of the learner's personal vocabulary cards. */
  card(id: string): Promise<Stored<PersonalCard> | undefined>;
  /** Every personal vocabulary card the learner has, keyed by id. */
  cards(): Promise<ReadonlyMap<string, Stored<PersonalCard>>>;
  /** Strongly consistent fixed pages; a cursor belongs to this learner and bucket. */
  vocabCandidatesByKeys(
    candidates: readonly VocabCandidate[],
  ): Promise<ReadonlyMap<string, Stored<VocabCandidate>>>;
  vocabCandidates(request: CandidatePageRequest): Promise<CandidatePage>;
  vocabReadModel(day: DayKey): Promise<Stored<VocabReadModel> | undefined>;
  vocabReadModelRequest(
    day: DayKey,
  ): Promise<Stored<VocabReadModelRequest> | undefined>;
  vocabReadModelRequests(cursor: string | null): Promise<VocabReadModelRequestPage>;
  readModelSource(): Promise<Stored<ReadModelSource> | undefined>;
  personalCardPage(cursor: string | null): Promise<PersonalCardPage>;
  vocabItemsByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<VocabProgress>>>;
  itemsByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<ItemProgress>>>;
  cardsByIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Stored<PersonalCard>>>;
  commit(commit: Commit): Promise<Result<undefined, CommitConflict>>;
}

/** The only way to a store: bound to the learner the request context names. */
export interface LearnerStores {
  forLearner(id: LearnerId): LearnerStore;
}

export interface ReviewPage {
  readonly entries: readonly ReviewEntry[];
  readonly cursor: string | null;
}
