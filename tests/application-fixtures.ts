import type { Entry, Profile } from "@instant-composition/application";
import type {
  DayTally,
  FsrsState,
  ItemProgress,
  LearnerStats,
  Portion,
  ReviewEntry,
  Round,
  Settings,
  Talk,
  Turn,
  VocabProgress,
  VocabReview,
  VocabSession,
} from "@instant-composition/domain";

// Factories for the packages/application suites. Nothing here asserts.

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    timeZone: "Europe/London",
    l1: "ja",
    target: "en",
    uiLocale: "ja",
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { topics: ["work"], focus: [], dailySize: 10, sound: true, ...overrides };
}

export function makeStats(overrides: Partial<LearnerStats> = {}): LearnerStats {
  return {
    points: 0,
    completedDays: [],
    firstDay: null,
    said: 0,
    practicedDays: 0,
    level: null,
    levelWindow: [],
    openRound: null,
    titles: [],
    ...overrides,
  };
}

export function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: "r1",
    kind: "today",
    day: "2026-09-22",
    portionDay: "2026-09-22",
    deck: ["c1", "c2", "c3", "c4", "c5"],
    limitMs: 30_000,
    startedAt: 1_000,
    finishedAt: null,
    abandonedAt: null,
    firstPass: 0,
    outcome: null,
    ...overrides,
  };
}

/** The FSRS state a new card's first answer, graded good on 2026-09-22, leaves. */
export const FIRST_GOOD: FsrsState = {
  stability: 2.3065,
  difficulty: 2.118,
  reps: 1,
  lapses: 0,
  lastDay: "2026-09-22",
  dueDay: "2026-09-25",
};

/** A first-pass review of new card `c1` in round `r1`, graded good, overridable field by field. */
export function makeReview(overrides: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    id: "a1",
    item: { kind: "composition", id: "c1" },
    sessionId: "r1",
    answeredAt: 2_000,
    day: "2026-09-22",
    outcome: "good",
    before: null,
    after: null,
    fsrs: { before: null, after: FIRST_GOOD },
    snapshot: {
      topic: "work",
      subtopic: "meetings",
      level: 5,
      prompt: "会議を始めましょう。",
    },
    detail: {
      activity: "composition",
      pass: "first",
      result: "ok",
      grade: "good",
      timedOut: false,
      elapsedMs: 8_000,
      limitMs: 10_000,
      paceMs: 10_000,
    },
    ...overrides,
  };
}

/** A first-pass `ok` review logged under Leitner, before three grades, as stored then. */
export function makeLeitnerReview(overrides: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    id: "a0",
    item: { kind: "composition", id: "c1" },
    sessionId: "r0",
    answeredAt: 1_000,
    day: "2026-09-20",
    outcome: "good",
    before: null,
    after: { box: 1, dueDay: "2026-09-22", lastDay: "2026-09-20", seenCount: 1 },
    snapshot: {
      topic: "work",
      subtopic: "meetings",
      level: 5,
      prompt: "会議を始めましょう。",
    },
    detail: {
      activity: "composition",
      pass: "first",
      result: "ok",
      elapsedMs: 8_000,
      limitMs: 10_000,
      paceMs: 10_000,
    },
    ...overrides,
  };
}

export function makePortion(overrides: Partial<Portion> = {}): Portion {
  return {
    day: "2026-09-22",
    target: 10,
    progress: 0,
    completedAt: null,
    completedRound: null,
    ...overrides,
  };
}

export function makeDay(overrides: Partial<DayTally> = {}): DayTally {
  return {
    day: "2026-09-22",
    answers: 0,
    firstPass: 0,
    roundsStarted: 1,
    roundsFinished: 0,
    lastFinishedRound: null,
    ...overrides,
  };
}

/** Progress on `c1`, first answered on 2026-09-22 and graded good, overridable field by field. */
export function makeItem(overrides: Partial<ItemProgress> = {}): ItemProgress {
  return {
    item: { kind: "composition", id: "c1" },
    fsrs: FIRST_GOOD,
    okDays: ["2026-09-22"],
    mastered: null,
    placement: { topic: "work", subtopic: "meetings" },
    last: { sessionId: "r1", result: "ok", elapsedMs: 8_000, answeredAt: 2_000 },
    previous: null,
    ...overrides,
  };
}

/** A first turn of talk `t1`, judged `corrected` and answered. */
export function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    n: 1,
    partnerLine: "Hi! Are you new around here?",
    japanese: "先週引っ越してきました。",
    english: "I moved here last week.",
    judgment: {
      verdict: "corrected",
      modelAnswer: "I just moved here last week.",
      point: "「引っ越してきた」→ just moved here",
    },
    reply: "Oh, welcome! How do you like it so far?",
    ...overrides,
  };
}

/** An open talk `t1` with no turn yet, expiring a day after it started. */
export function makeTalk(overrides: Partial<Talk> = {}): Talk {
  return {
    id: "t1",
    status: "open",
    startedAt: 1_000,
    expiresAt: 86_401,
    scene: {
      partner: "近所の人",
      place: "マンションのエレベーター",
      relation: "初対面の隣人",
      description: "引っ越してきたばかりのあなたに、隣人が話しかけてきた。",
    },
    opening: "Hi! Are you new around here?",
    turns: [],
    model: {
      provider: "stand-in",
      modelId: "stand-in",
      prompts: {
        "talk-scene": "talk-scene@1",
        "talk-teacher": "talk-teacher@1",
        "talk-partner": "talk-partner@1",
      },
    },
    ...overrides,
  };
}

/** Progress on vocabulary card `v1`, answered once on 2026-09-22 and graded good. */
export function makeVocabProgress(
  overrides: Partial<VocabProgress> = {},
): VocabProgress {
  return {
    cardId: "v1",
    source: { kind: "catalog" },
    state: {
      stability: 2.3065,
      difficulty: 2.118,
      reps: 1,
      lapses: 0,
      lastDay: "2026-09-22",
      dueDay: "2026-09-25",
    },
    firstDay: "2026-09-22",
    ...overrides,
  };
}

/** An open vocabulary session `s1` of today's queue, dealt on 2026-09-22. */
export function makeVocabSession(overrides: Partial<VocabSession> = {}): VocabSession {
  return {
    id: "s1",
    kind: "today",
    category: null,
    day: "2026-09-22",
    deck: ["v1", "v2"],
    startedAt: 1_000,
    finishedAt: null,
    tomorrow: null,
    ...overrides,
  };
}

/** The first answer of `v1` in session `s1`, graded good, which introduced it. */
export function makeVocabReview(overrides: Partial<VocabReview> = {}): VocabReview {
  return {
    id: "va1",
    sessionId: "s1",
    cardId: "v1",
    answeredAt: 2_000,
    day: "2026-09-22",
    pass: "first",
    grade: "good",
    elapsedMs: 4_000,
    before: null,
    after: makeVocabProgress().state,
    snapshot: {
      headword: "give up",
      meaning: "あきらめる",
      category: "phrasal-verb",
      level: 4,
    },
    ...overrides,
  };
}

/**
 * `value` with fields its type no longer declares, as an item written while the
 * typed-answer mode existed holds them.
 */
export function withRetired<T extends object>(
  value: T,
  retired: Readonly<Record<string, unknown>>,
): T {
  return { ...value, ...retired };
}

/** A copy of `value` without `key`. */
export function without<T extends object>(value: T, key: keyof T): T {
  const copy = { ...value };
  Reflect.deleteProperty(copy, key);
  return copy;
}

/** One entry of every type, so a suite over them covers the whole store. */
export function oneOfEach(): Entry[] {
  return [
    { type: "profile", value: makeProfile() },
    { type: "settings", value: makeSettings() },
    { type: "stats", value: makeStats() },
    { type: "round", value: makeRound() },
    { type: "review", value: makeReview() },
    { type: "portion", value: makePortion() },
    { type: "day", value: makeDay() },
    { type: "item", value: makeItem() },
    { type: "talk", value: makeTalk({ turns: [makeTurn()] }) },
    { type: "vocabItem", value: makeVocabProgress() },
    { type: "vocabSession", value: makeVocabSession() },
    { type: "vocabReview", value: makeVocabReview() },
  ];
}
