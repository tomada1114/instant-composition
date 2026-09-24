// The web client's surface for the tests under tests/: the app itself, the
// catalog provider a rendered component needs, and the logic modules each
// test drives directly. `main.tsx` is the browser entry and is not part of it.
export { App } from "./app";
export {
  createAnswerQueue,
  type AnswerQueue,
  type QueueStorage,
} from "./drill/answer-queue";
export { CardBack, CardFront } from "./drill/flashcard";
export { IntroScreen } from "./drill/intro-screen";
export { PauseSheet } from "./drill/pause-sheet";
export { TimerBar } from "./drill/timer-bar";
export { TopStrip } from "./drill/top-strip";
export { drillReducer } from "./drill/drill-machine";
export {
  answerId,
  currentCard,
  initDrill,
  progress,
  remainingMs,
  type AnswerInput,
  type DrillEvent,
  type DrillInit,
  type DrillPhase,
  type DrillState,
} from "./drill/drill-state";
export { keyAction, type DrillKeyAction } from "./drill/keys";
export { playMotion, prefersReducedMotion } from "./drill/motion";
export { requestFinish, requestRound, roundKindFrom, sendAnswer } from "./drill/rounds";
export {
  browserSound,
  createSoundPlayer,
  type SoundName,
  type ToneContext,
} from "./drill/sound";
export {
  feedbackMs,
  useAnswerSync,
  useDrillClock,
  useDrillKeys,
  useRoundFinish,
  type FinishState,
} from "./drill/use-drill";
export { LOCALE, MESSAGES, type Messages } from "./i18n/messages";
export { CatalogProvider } from "./i18n/provider";
export {
  API_ROOT,
  finishRound,
  getHome,
  operationUrl,
  recordAnswers,
  startRound,
  updateSettings,
  type ApiError,
  type SendOutcome,
} from "./lib/endpoints";
export { KeyMode } from "./lib/key-mode";
export { isFast, TUNING } from "./lib/tuning";
export { cn } from "./lib/utils";
export type {
  Answer,
  AnswerResult,
  Dot,
  DrillCard,
  Growth,
  HomePreview,
  HomeState,
  HomeView,
  Pass,
  ReachView,
  RoundKind,
  RoundPayload,
  RoundSummary,
  SettingsPatch,
  SettingsView,
  StreakView,
} from "./openapi";
export { countUpPlan, valueAt, type CountUp } from "./summary/count-up";
export { SummaryScreen } from "./summary/summary-screen";
export { parseTitleKey, type ParsedTitle } from "./summary/titles";
export { Button } from "./ui/button";
