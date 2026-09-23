import type { Entry } from "@instant-composition/application";
import type {
  DayTally,
  ItemProgress,
  LearnerStats,
  Portion,
  ReviewEntry,
  Round,
  Settings,
} from "@instant-composition/domain";

// Factories for the packages/application suites. Nothing here asserts.

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
    startedAt: 1_000,
    finishedAt: null,
    abandonedAt: null,
    firstPass: 0,
    outcome: null,
    ...overrides,
  };
}

/** A first-pass `ok` review of `c1` in round `r1`, overridable field by field. */
export function makeReview(overrides: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    id: "a1",
    item: { kind: "composition", id: "c1" },
    sessionId: "r1",
    answeredAt: 2_000,
    day: "2026-09-22",
    outcome: "good",
    before: null,
    after: { box: 1, dueDay: "2026-09-24", lastDay: "2026-09-22", seenCount: 1 },
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

export function makeItem(overrides: Partial<ItemProgress> = {}): ItemProgress {
  return {
    item: { kind: "composition", id: "c1" },
    memory: { box: 1, dueDay: "2026-09-24", lastDay: "2026-09-22", seenCount: 1 },
    okDays: ["2026-09-22"],
    mastered: null,
    placement: { topic: "work", subtopic: "meetings" },
    last: { sessionId: "r1", result: "ok", elapsedMs: 8_000, answeredAt: 2_000 },
    previous: null,
    ...overrides,
  };
}

/** One entry of every type, so a suite over them covers the whole store. */
export function oneOfEach(): Entry[] {
  return [
    { type: "settings", value: makeSettings() },
    { type: "stats", value: makeStats() },
    { type: "round", value: makeRound() },
    { type: "review", value: makeReview() },
    { type: "portion", value: makePortion() },
    { type: "day", value: makeDay() },
    { type: "item", value: makeItem() },
  ];
}
