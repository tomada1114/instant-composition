// The pure rules of the application: no I/O, no clock, no process state. Time,
// the learner's time zone and randomness arrive as arguments.
export { deriveCardStates } from "./card-state";
export {
  compose,
  countAvailable,
  type ComposeInput,
  type Composition,
  type NotEnoughCards,
} from "./compose";
export { addDays, calendarWeeks, dayDiff, dayOf, weekdayIndex, weekOf } from "./day";
export {
  adjustLevel,
  type DifficultyAnswer,
  type LevelAdjustment,
  type LevelChange,
} from "./difficulty";
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
  masteredCards,
  nearestMilestone,
  reachBySubtopic,
  reachByTopic,
  resolvePlacement,
  ringProgress,
  type Mastery,
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
  choosePlacement,
  placementLevel,
  type PlacementAnswer,
  type PlacementInput,
} from "./placement";
export { roundPoints, totals, type Totals } from "./points";
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
export {
  countWords,
  estimateMinutes,
  isFast,
  limitMsForWords,
  limitSecondsForWords,
} from "./timer";
export { TUNING, type MilestoneSeries } from "./tuning";
export type {
  AnswerRecord,
  AnswerResult,
  CardContent,
  CardMeta,
  CardState,
  DailySize,
  DayKey,
  Pass,
  RoundKind,
  Settings,
  SubtopicRef,
  TombstoneMeta,
  TopicInfo,
} from "./types";
