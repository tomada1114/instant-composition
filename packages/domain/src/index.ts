// The pure rules of the application: no I/O, no clock, no process state. Time,
// the learner's time zone and randomness arrive as arguments.
export { decideAnswers, type AnswersChange, type AnswersState } from "./answers";
export { nextCardState, type LeitnerAnswer } from "./card-state";
export { checkAnswers, type AnswerInput, type CardFacts } from "./check-answers";
export {
  decideClose,
  streakValue,
  type CloseCatalog,
  type CloseChange,
  type CloseState,
} from "./close";
export {
  compose,
  countAvailable,
  type ComposeInput,
  type Composition,
  type NotEnoughCards,
} from "./compose";
export {
  addDays,
  calendarWeeks,
  dayDiff,
  dayOf,
  timeZoneOf,
  weekdayIndex,
  weekOf,
} from "./day";
export {
  availableFor,
  deal,
  practiceState,
  refitDeck,
  seedFor,
  type PracticeState,
} from "./deck";
export {
  adjustLevel,
  suggestLevel,
  type DifficultyAnswer,
  type LevelAdjustment,
  type LevelChange,
} from "./difficulty";
export { EMPTY_STATS, emptyTally } from "./empty";
export type { PracticeError, TalkError } from "./errors";
export { previewGrades, retrievability, scheduleCard } from "./fsrs";
export type { FsrsGrade, FsrsState, GradePreview, Scheduled } from "./fsrs";
export {
  reviewList,
  roundGrowth,
  type Growth,
  type GrowthInput,
  type GrowthRow,
  type ReviewRow,
} from "./growth";
export {
  homeState,
  type ActiveRound,
  type HomeInput,
  type HomeState,
  type PortionProgress,
  type StreakView,
} from "./home-state";
export {
  nearestMilestone,
  pendingReach,
  reachBySubtopic,
  reachByTopic,
  resolvePlacement,
  ringProgress,
  type RingProgress,
} from "./mastery";
export {
  crossedMilestones,
  newTitles,
  nextMilestone,
  parseTitleKey,
  previousMilestone,
  type ParsedTitle,
  type TitleInput,
  type TitleSeries,
} from "./milestones";
export {
  decideLevel,
  levelModeOf,
  settleLevel,
  suggestedLevel,
  type LevelChoice,
  type LevelSettled,
} from "./level";
export {
  choosePlacement,
  placementLevel,
  type PlacementAnswer,
  type PlacementInput,
} from "./placement";
export { roundPoints, totals, type Totals } from "./points";
export type {
  CompositionDetail,
  DayTally,
  FirstPassMark,
  ItemProgress,
  ItemRef,
  ItemSnapshot,
  LearnerStats,
  LevelEntry,
  LevelMode,
  LevelReason,
  Outcome,
  Portion,
  ReviewEntry,
  Round,
} from "./records";
export type { RoundOutcome } from "./round-outcome";
export {
  logOrder,
  outcomeOf,
  replayItems,
  reviewAnswer,
  type AcceptedAnswer,
} from "./review";
export { growthOf } from "./round-growth";
export {
  decideSettings,
  DEFAULT_SETTINGS,
  gradeKeysOf,
  isGradeKey,
  isGradeKeyPair,
  limitSecondsOf,
  withDefaults,
  type SettingsDecided,
  type SettingsPatch,
} from "./settings";
export {
  decideStart,
  type StartChange,
  type StartCommand,
  type StartState,
} from "./start";
export { randomIndex, seededRandom, shuffled, type Random } from "./random";
export { err, ok, type Result } from "./result";
export {
  calendarDots,
  isYesterdayRecoverable,
  longestRun,
  runEndingAt,
  streakStatus,
  weekDots,
  type CompletedDays,
  type Dot,
  type DotState,
  type StreakStatus,
} from "./streak";
export type { Judgment, Scene, SceneKind, Talk, TalkTask, Turn } from "./talk";
export { decideEnd, decideRecital, decideReply, withReply } from "./talk-close";
export { isClosing, liveTalk, openTalk, sceneKindOf } from "./talk-start";
export { decideTurn, keepTurn, type TeacherJudgment } from "./talk-turn";
export type { TurnCommand } from "./talk-turn";
export {
  countWords,
  estimateMinutes,
  isFast,
  limitMsOf,
  paceMsForWords,
  paceMsOf,
  paceOf,
  paceSecondsForWords,
  type Paced,
} from "./timer";
export { TALK_TUNING, TUNING, type MilestoneSeries } from "./tuning";
export type {
  AnswerRecord,
  AnswerResult,
  CardContent,
  CardMeta,
  CardState,
  ConceptId,
  DailySize,
  DayKey,
  GradeKeys,
  LimitSeconds,
  Pass,
  RetiredCard,
  RoundKind,
  Settings,
  SubtopicRef,
  TopicInfo,
} from "./types";
export {
  weaknesses,
  type ConceptWeakness,
  type SubtopicWeakness,
  type WeaknessEvidence,
  type WeaknessInput,
  type Weaknesses,
} from "./weakness";
