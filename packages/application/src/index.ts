// Commands, queries and the ports they need, written over `@instant-composition/domain`.
export {
  type StorageBootstrapRelease,
  type ReadModelBootstrapState,
  type ReadModelBootstrapStorage,
  advanceReadModelBootstrap,
  type ReadModelBootstrapDriver,
  type ReadModelBootstrapResult,
  vocabReadModelsReady,
  compositionSchemaSupported,
  type CompositionBuild,
  type CompositionReadModel,
  type CompositionSource,
  type CompositionMaintenanceStep,
  type ItemPageRequest,
  type PortionRange,
  type StorePage,
  type StreakMigration,
  rebuildCompositionReadModel,
  compositionReadModelsReady,
  compositionReadModelsValidity,
  compositionCandidateId,
  type CompositionCandidate,
  type CompositionCandidateRequest,
  READ_MODEL_PAGE_SIZE,
  CANDIDATE_PAGE_SIZE,
  vocabCandidateId,
  type CandidateMode,
  type CandidatePage,
  type CandidatePageRequest,
  type PersonalCardPage,
  type ReadModelSource,
  type ReadModelStep,
  type VocabCandidate,
  type VocabCounts,
  type VocabReadModel,
  type VocabReadModelRequest,
  type VocabReadModelRequestPage,
  rebuildVocabReadModel,
  advanceReadModelMaintenance,
  type MaintenanceCheckpoint,
  type MaintenanceLearner,
  type MaintenanceResult,
  type ReadModelMaintenance,
  advanceStoredReadModelBootstrap,
} from "./read-models";
export {
  learnerId,
  requestContext,
  type Actor,
  type LearnerId,
  type LearnerProfile,
  type Profile,
  type ProfilePatch,
  type RequestContext,
  type SystemJob,
} from "./context";
export {
  cardFacts,
  type Catalog,
  type CatalogSnapshot,
  type CatalogUnreadable,
  type LevelInfo,
} from "./catalog";
export {
  catalogSnapshotOf,
  type CatalogDocument,
  type CompositionItem,
  type ConceptEntry,
  type LanguageTag,
  type LevelStep,
  type Localization,
  type Localized,
  type TombstoneItem,
  type TopicEntry,
  type WithdrawnItem,
} from "./catalog-document";
export type { VocabCategory, VocabItem } from "./vocab-item";
export { recordVocabAnswers, type VocabAnswersCommand } from "./vocab-answers";
export {
  startVocabSession,
  vocabHub,
  type StartVocabSessionCommand,
} from "./vocab-session";
export type {
  VocabAgainRow,
  VocabCardView,
  VocabCategoryView,
  VocabHub,
  VocabSessionView,
  VocabSummary,
} from "./vocab-views";
export type {
  ApplicationError,
  ApplicationErrorCode,
  TalkCommandError,
} from "./errors";
export { type ApplicationDeps } from "./execute";
export { deleteVocabCard } from "./delete-card";
export { endTalk, recordRecital, type RecitalCommand } from "./end-talk";
export { getTalk } from "./get-talk";
export { finishRound } from "./finish-round";
export { home } from "./home";
export {
  authorize,
  LEARNER_OPERATIONS,
  SYSTEM_OPERATIONS,
  type OperationKind,
} from "./operations";
export { profile, updateProfile } from "./profile";
export { history, roundPayload, roundSummary, settingsPage } from "./queries";
export type {
  BreakdownTopic,
  History,
  HomePreview,
  HomeView,
  RecordsView,
  SettingsPageView,
  TitleGroup,
  WeakPoints,
} from "./query-views";
export type {
  AbortSignalLike,
  JsonSchemaObject,
  JsonValue,
  LanguageModel,
  ModelCall,
  ModelFailure,
  ModelMessage,
  ModelReply,
  ModelRequest,
} from "./language-model";
export { finishVocabSession } from "./finish-vocab-session";
export { recordAnswers, type RecordAnswersCommand } from "./record-answers";
export { records } from "./records";
export {
  DEFAULT_PROFILE,
  signIn,
  type LearnerDirectory,
  type Registration,
  type SignInDeps,
} from "./sign-in";
export { retryReply, sendTurn, type SendTurnCommand } from "./send-turn";
export { startRound } from "./start-round";
export { startTalk } from "./start-talk";
export {
  keyOf,
  type Commit,
  type CommitConflict,
  type Entry,
  type Key,
  type LearnerStore,
  type LearnerStores,
  type ReviewPage,
  type Stored,
} from "./store";
export {
  addCards,
  makeCandidates,
  type AddCardsCommand,
  type CardDeps,
} from "./talk-candidates";
export { TALK_PROMPTS, type TalkDeps, type TalkRequest } from "./talk-model";
export type {
  CardCandidates,
  CardCandidateView,
  PartnerReply,
  TalkEnded,
  TalkOpened,
  TalkView,
  TurnResult,
} from "./talk-views";
export { updateLevel } from "./update-level";
export { updateSettings } from "./update-settings";
export type {
  AnsweredRow,
  DrillCard,
  GradeIntervals,
  LevelView,
  ReachTopic,
  ReachView,
  RoundPayload,
  RoundSummary,
  SettingsView,
  TotalsView,
} from "./views";
export { startPagedVocabSession, preparePagedVocabSession } from "./vocab-page-prepare";
export { getPagedVocabPage } from "./vocab-page-read";
export {
  recordPagedVocabAnswers,
  type VocabPagedAnswersCommand,
} from "./vocab-page-answers";
export { finishPagedVocabSession } from "./vocab-page-finish";
export type {
  VocabPreparation,
  VocabPageView,
  VocabPagedSummary,
} from "./vocab-page-views";
