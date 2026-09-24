import { errorResponseSchema } from "./errors";
import {
  answerResultSchema,
  dotSchema,
  passSchema,
  reachTopicSchema,
  reachViewSchema,
  ringProgressSchema,
  roundKindSchema,
  settingsSchema,
  subtopicRefSchema,
} from "./primitives";
import {
  breakdownTopicSchema,
  historySchema,
  homePreviewSchema,
  homeStateSchema,
  homeViewSchema,
  recordsViewSchema,
  settingsPageViewSchema,
  streakViewSchema,
  titleGroupSchema,
  topicInfoSchema,
} from "./query-views";
import {
  answerSchema,
  answersRequestSchema,
  settingsPatchSchema,
  startRoundRequestSchema,
} from "./requests";
import {
  drillCardSchema,
  growthRowSchema,
  growthSchema,
  reviewRowSchema,
  roundPayloadSchema,
  roundSummarySchema,
  settingsViewSchema,
  totalsViewSchema,
} from "./views";

/**
 * The schemas the document names under `components.schemas`, by the name a
 * generated client gives each type. A schema listed here is written once and
 * referenced wherever it is used; one left out is inlined. Every request and
 * response body has to be listed, which `openApiDocument` checks.
 */
export const COMPONENTS = {
  RoundKind: roundKindSchema,
  Pass: passSchema,
  AnswerResult: answerResultSchema,
  SubtopicRef: subtopicRefSchema,
  Settings: settingsSchema,
  Dot: dotSchema,
  RingProgress: ringProgressSchema,
  ReachTopic: reachTopicSchema,
  ReachView: reachViewSchema,
  StartRoundRequest: startRoundRequestSchema,
  Answer: answerSchema,
  AnswersRequest: answersRequestSchema,
  SettingsPatch: settingsPatchSchema,
  DrillCard: drillCardSchema,
  RoundPayload: roundPayloadSchema,
  GrowthRow: growthRowSchema,
  Growth: growthSchema,
  ReviewRow: reviewRowSchema,
  TotalsView: totalsViewSchema,
  RoundSummary: roundSummarySchema,
  SettingsView: settingsViewSchema,
  StreakView: streakViewSchema,
  HomeState: homeStateSchema,
  HomePreview: homePreviewSchema,
  HomeView: homeViewSchema,
  BreakdownTopic: breakdownTopicSchema,
  TitleGroup: titleGroupSchema,
  RecordsView: recordsViewSchema,
  TopicInfo: topicInfoSchema,
  SettingsPageView: settingsPageViewSchema,
  History: historySchema,
  ErrorResponse: errorResponseSchema,
} as const;
