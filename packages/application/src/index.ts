// Commands, queries and the ports they need, written over `@instant-composition/domain`.
export {
  learnerId,
  requestContext,
  type Actor,
  type LearnerId,
  type LearnerProfile,
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
  type ConceptId,
  type LanguageTag,
  type LevelStep,
  type Localization,
  type Localized,
  type TombstoneItem,
  type TopicEntry,
  type WithdrawnItem,
} from "./catalog-document";
export type { ApplicationError, ApplicationErrorCode } from "./errors";
export { type ApplicationDeps } from "./execute";
export { finishRound } from "./finish-round";
export { home } from "./home";
export {
  authorize,
  LEARNER_OPERATIONS,
  SYSTEM_OPERATIONS,
  type OperationKind,
} from "./operations";
export { history, recap, roundSummary, settingsPage } from "./queries";
export type {
  BreakdownTopic,
  History,
  HomePreview,
  HomeView,
  RecordsView,
  SettingsPageView,
  TitleGroup,
} from "./query-views";
export { recordAnswers, type RecordAnswersCommand } from "./record-answers";
export { records } from "./records";
export { startRound } from "./start-round";
export {
  keyOf,
  type Commit,
  type CommitConflict,
  type Entry,
  type Key,
  type LearnerStore,
  type LearnerStores,
  type Stored,
} from "./store";
export { updateSettings } from "./update-settings";
export type {
  DrillCard,
  ReachTopic,
  ReachView,
  RoundPayload,
  RoundSummary,
  SettingsView,
  TotalsView,
} from "./views";
