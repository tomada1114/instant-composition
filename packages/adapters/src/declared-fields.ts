import type {
  CompositionDetail,
  FirstPassMark,
  ItemProgress,
  PersonalCard,
  Round,
  Settings,
  Talk,
  Turn,
  VocabProgress,
  VocabReview,
  VocabSession,
} from "@instant-composition/domain";

/**
 * Every field `T` declares, optional ones included. A field added to the type
 * fails to compile at its list below until it is named there, so a read never
 * drops a field the code writes.
 */
export type Fields<T> = { readonly [K in keyof T]-?: true };

export const SETTINGS = {
  topics: true,
  focus: true,
  dailySize: true,
  sound: true,
  limitSeconds: true,
  gradeKeys: true,
  newPerDay: true,
  reviewsPerDay: true,
  vocabNewPerDay: true,
  vocabReviewsPerDay: true,
} as const satisfies Fields<Settings>;

export const ROUND = {
  answerState: true,
  id: true,
  kind: true,
  day: true,
  portionDay: true,
  deck: true,
  limitMs: true,
  startedAt: true,
  finishedAt: true,
  abandonedAt: true,
  firstPass: true,
  outcome: true,
} as const satisfies Fields<Round>;

export const DETAIL = {
  activity: true,
  pass: true,
  result: true,
  grade: true,
  timedOut: true,
  elapsedMs: true,
  limitMs: true,
  paceMs: true,
} as const satisfies Fields<CompositionDetail>;

export const ITEM = {
  item: true,
  revision: true,
  memory: true,
  fsrs: true,
  okDays: true,
  mastered: true,
  placement: true,
  last: true,
  previous: true,
} as const satisfies Fields<ItemProgress>;

export const MARK = {
  sessionId: true,
  result: true,
  elapsedMs: true,
  answeredAt: true,
} as const satisfies Fields<FirstPassMark>;

export const TALK = {
  id: true,
  status: true,
  startedAt: true,
  endedAt: true,
  expiresAt: true,
  scene: true,
  opening: true,
  turns: true,
  model: true,
  cards: true,
} as const satisfies Fields<Talk>;

export const TURN = {
  n: true,
  partnerLine: true,
  japanese: true,
  english: true,
  judgment: true,
  reply: true,
  revealCount: true,
} as const satisfies Fields<Turn>;

export const VOCAB_ITEM = {
  cardId: true,
  source: true,
  state: true,
  firstDay: true,
} as const satisfies Fields<VocabProgress>;

export const VOCAB_SESSION = {
  id: true,
  kind: true,
  category: true,
  day: true,
  deck: true,
  startedAt: true,
  finishedAt: true,
  tomorrow: true,
} as const satisfies Fields<VocabSession>;

export const VOCAB_REVIEW = {
  id: true,
  sessionId: true,
  cardId: true,
  answeredAt: true,
  day: true,
  pass: true,
  grade: true,
  elapsedMs: true,
  before: true,
  after: true,
  snapshot: true,
} as const satisfies Fields<VocabReview>;

export const CARD = {
  ...{ id: true, target: true, l1: true, category: true, level: true, headword: true },
  ...{ definition: true, example: true, example2: true, meaning: true, source: true },
  createdAt: true,
} as const satisfies Fields<PersonalCard>;
