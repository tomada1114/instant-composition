// Commands, queries and the ports they need, written over `@instant-composition/domain`.
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
export {
  finishVocabSession,
  recordVocabAnswers,
  type VocabAnswersCommand,
} from "./vocab-answers";
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
