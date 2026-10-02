// The web client's surface for the tests under tests/: the app itself, the
// catalog provider a rendered component needs, and the logic modules each
// test drives directly. `main.tsx` is the browser entry and is not part of it.
export { App } from "./app";
export {
  createAnswerQueue,
  flushEarlierRounds,
  unsavedAnswers,
  type AnswerQueue,
  type ListedStorage,
  type QueueStorage,
} from "./drill/answer-queue";
export { useAnswerQueue, useQueuedDrill, type ArrivedQueue } from "./drill/answer-sync";
export { CardBack, CardFront } from "./drill/flashcard";
export { IntroScreen } from "./drill/intro-screen";
export { PauseDialog } from "./drill/pause-dialog";
export { TimerBar } from "./drill/timer-bar";
export { TopStrip } from "./drill/top-strip";
export { drillReducer } from "./drill/drill-machine";
export {
  answerId,
  currentCard,
  progress,
  remainingMs,
  type AnswerInput,
  type DrillEvent,
  type DrillInit,
  type DrillPhase,
  type DrillState,
} from "./drill/drill-state";
export { initDrill } from "./drill/drill-init";
export { keyAction, type DrillKeyAction, type KeyPress } from "./drill/keys";
export { playMotion, prefersReducedMotion } from "./drill/motion";
export { requestFinish, requestRound, roundKindFrom, sendAnswer } from "./drill/rounds";
export {
  browserSound,
  createSoundPlayer,
  roundSound,
  type SoundName,
  type ToneContext,
} from "./drill/sound";
export {
  feedbackMs,
  useDrillClock,
  useDrillKeys,
  useRoundFinish,
  type FinishState,
} from "./drill/use-drill";
export { LOCALE, MESSAGES, type Messages } from "./i18n/messages";
export { CatalogProvider } from "./i18n/provider";
// The translator `useTranslations` formats with, so tests/messages.test.ts can
// parse every message the way the client renders it: the root declares no
// `use-intl` of its own for a test to import.
export { createTranslator } from "use-intl";
export {
  API_ROOT,
  beginVisit,
  finishRound,
  getHome,
  getRecords,
  getRoundSummary,
  getSettings,
  LOGIN_URL,
  LOGOUT_URL,
  operationUrl,
  REFRESH_URL,
  recordAnswers,
  startRound,
  updateLevel,
  updateProfile,
  updateSettings,
  type ApiError,
  type SendOutcome,
} from "./lib/endpoints";
export { isDefaultGradeKeys, isGradeKey, keyLabel } from "./lib/grade-keys";
export { KeyMode } from "./lib/key-mode";
export { isFast, TUNING } from "./lib/tuning";
export { cn } from "./lib/utils";
export type {
  Answer,
  AnswerResult,
  Dot,
  DrillCard,
  GradeKeys,
  Growth,
  HomePreview,
  HomeState,
  HomeView,
  Judgment,
  LevelChoice,
  LevelView,
  PartnerReply,
  Pass,
  Profile,
  ProfilePatch,
  ReachView,
  RecordsView,
  RoundKind,
  RoundPayload,
  RoundSummary,
  Settings,
  SettingsPageView,
  SettingsPatch,
  SettingsView,
  StreakView,
  TalkOpened,
  TopicInfo,
  TurnResult,
  Verdict,
} from "./openapi";
export { countUpPlan, valueAt, type CountUp } from "./summary/count-up";
export { SummaryScreen } from "./summary/summary-screen";
export { parseTitleKey, type ParsedTitle } from "./summary/titles";
export { ANSWER_FIELD_MAX, AnswerField } from "./ui/answer-field";
export { Button } from "./ui/button";
export { BoltGlyph, FlameGlyph, StarGlyph, TargetGlyph } from "./ui/filled-glyphs";
export { HiddenAnswer } from "./ui/hidden-answer";
export { Dialog } from "./ui/dialog";
export { Segmented } from "./ui/segmented";
export { TalkLine, WaitingLine } from "./ui/talk-line";
export {
  IDLE as TALK_IDLE,
  talkReducer,
  type TalkEvent,
  type TalkState,
} from "./talk/talk-state";
