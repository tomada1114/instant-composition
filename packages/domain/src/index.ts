// The pure rules of the application: no I/O, no clock, no process state. Time,
// the learner's time zone and randomness arrive as arguments. Exports are
// grouped a few names to a line, one module at a time.
export { decideAnswers, type AnswersChange, type AnswersState } from "./answers";
export { gradedOf, gradeOf, intervalsOf, movesItem, resultOf } from "./card-state";
export type { GradeInput, Graded } from "./card-state";
export { checkAnswers, type AnswerInput, type CardFacts } from "./check-answers";
export { decideClose, streakValue } from "./close";
export type { CloseCatalog, CloseChange, CloseState } from "./close";
export {
  compose,
  composeExtra,
  countAvailable,
  portionSize,
  wantedToday,
} from "./compose";
export type { ComposeInput, Composition, NotEnoughCards } from "./compose";
export { addDays, calendarWeeks, dayDiff, dayOf } from "./day";
export { timeZoneOf, weekdayIndex, weekOf } from "./day";
export { availableFor, deal, dealExtraDeck, practiceState } from "./deck";
export { refitDeck, seedFor, type PracticeState } from "./deck";
export { adjustLevel, suggestLevel } from "./difficulty";
export type { DifficultyAnswer, LevelAdjustment, LevelChange } from "./difficulty";
export { drillQueue, pickNew } from "./drill-queue";
export type { DrillQueue, DrillQueueInput, SeenCard } from "./drill-queue";
export { EMPTY_STATS, emptyTally } from "./empty";
export type { PracticeError, TalkError, VocabError } from "./errors";
export { previewGrades, retrievability, scheduleCard } from "./fsrs";
export type { FsrsGrade, FsrsState, GradePreview, Scheduled } from "./fsrs";
export { gradeKeysOf, isGradeKey, isGradeKeyPair } from "./grade-keys";
export type { Growth, GrowthRow, ReviewRow } from "./growth";
export { homeState } from "./home-state";
export type { ActiveRound, HomeInput, HomeState } from "./home-state";
export type { PortionProgress, StreakView } from "./home-state";
export { nearestMilestone, pendingReach, reachBySubtopic } from "./mastery";
export { reachByTopic, resolvePlacement, ringProgress } from "./mastery";
export type { RingProgress } from "./mastery";
export { crossedMilestones, newTitles, nextMilestone } from "./milestones";
export { parseTitleKey, previousMilestone } from "./milestones";
export type { ParsedTitle, TitleInput, TitleSeries } from "./milestones";
export { decideLevel, levelModeOf, settleLevel, suggestedLevel } from "./level";
export type { LevelChoice, LevelSettled } from "./level";
export { choosePlacement, placementLevel } from "./placement";
export type { PlacementAnswer, PlacementInput } from "./placement";
export { roundPoints, totals, type Totals } from "./points";
export { todaysQueue, type DailyLimit, type QueueCandidate } from "./queue";
export type { QueuedCard, QueueInput, TodaysQueue } from "./queue";
export type { CompositionDetail, DayTally, FirstPassMark } from "./records";
export type { ItemProgress, ItemRef, ItemSnapshot, LearnerStats } from "./records";
export type { LevelEntry, LevelMode, LevelReason, Outcome } from "./records";
export type { Portion, ReviewEntry, Round } from "./records";
export type { RoundOutcome } from "./round-outcome";
export { logOrder, replayItems, reviewAnswer, type AcceptedAnswer } from "./review";
export { growthOf } from "./round-growth";
export { decideSettings, DEFAULT_SETTINGS, drillLimitsOf } from "./settings";
export { limitSecondsOf, withDefaults } from "./settings";
export type { SettingsDecided, SettingsPatch, ShownSettings } from "./settings";
export { decideStart } from "./start";
export type { StartChange, StartCommand, StartState } from "./start";
export { randomIndex, seededRandom, shuffled, type Random } from "./random";
export { err, ok, type Result } from "./result";
export { calendarDots, isYesterdayRecoverable, longestRun } from "./streak";
export { runEndingAt, streakStatus, weekDots } from "./streak";
export type { CompletedDays, Dot, DotState, StreakStatus } from "./streak";
export {
  compactStats,
  joinStreakRun,
  streakFromRuns,
  type StreakRun,
} from "./streak-runs";
export type { Judgment, Scene, SceneKind, Talk, TalkTask, Turn } from "./talk";
export type { AddedCandidate, CardCandidate, TalkCards } from "./talk";
export { correctedTurns, decideAddCards, decideCandidates } from "./talk-cards";
export { personalCardId, pickCandidates } from "./talk-cards";
export type { AddCardsState } from "./talk-cards";
export { decideEnd, decideRecital, decideReply, withReply } from "./talk-close";
export { isClosing, liveTalk, openTalk, sceneKindOf } from "./talk-start";
export { decideTurn, keepTurn, type TeacherJudgment } from "./talk-turn";
export type { TurnCommand } from "./talk-turn";
export { countWords, estimateMinutes, isFast, limitMsOf } from "./timer";
export {
  fastMsOf,
  paceMsForWords,
  paceMsOf,
  paceOf,
  paceSecondsForWords,
} from "./timer";
export type { Paced } from "./timer";
export {
  decideModelTask,
  type ModelTask,
  type ModelTaskDecision,
  type ModelTaskKey,
} from "./model-task";
export { TALK_TUNING, TUNING, VOCAB_TUNING, type MilestoneSeries } from "./tuning";
export type { AnswerRecord, AnswerResult, CardContent, CardMeta } from "./types";
export type { CardState, ConceptId, DailySize, DayKey } from "./types";
export type { DrillNewPerDay, DrillReviewsPerDay, GradeKeys } from "./types";
export type { LimitSeconds, Pass, RetiredCard, RoundKind, Settings } from "./types";
export type { SubtopicRef, TopicInfo } from "./types";
export type { VocabAnswer, VocabProgress, VocabReview, VocabSession } from "./vocab";
export { fitsCardText, normalizeHeadword } from "./vocab-card";
export type { CardText, PersonalCard } from "./vocab-card";
export { summarizeVocabReviews, type VocabReviewSummary } from "./vocab-summary";
export { planVocab, type VocabPlan } from "./vocab-plan";
export { dealVocab, decideVocabAnswers, vocabFigures } from "./vocab-study";
export {
  rankWeaknesses,
  weaknesses,
  type ConceptWeakness,
  type SubtopicWeakness,
} from "./weakness";
export type { WeaknessEvidence, WeaknessInput, Weaknesses } from "./weakness";

export { answeredOn, isNewCard, isWeak, recallOf, newCardOrder } from "./vocab";

export {
  VOCAB_PAGE_SIZE,
  VOCAB_AGAIN_PREVIEW,
  vocabFreshPosition,
  type VocabPagedSession,
  type VocabDeckPage,
  type VocabPageProgress,
  type VocabPagedAnswer,
  type VocabSessionGuard,
} from "./vocab-pages";
