import type {
  AnswerRecord,
  AnswerResult,
  CardMeta,
  ItemProgress,
} from "@instant-composition/domain";

// Factories for the packages/domain suites. Nothing here asserts.

let sequence = 0;

/** A first-pass `ok` answer on 2026-09-22 with a 10-second limit, overridable field by field. */
export function makeAnswer(overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  sequence += 1;
  return {
    id: `a${String(sequence)}`,
    roundId: "r1",
    cardId: "c1",
    pass: "first",
    result: "ok",
    elapsedMs: 8_000,
    limitMs: 10_000,
    day: "2026-09-22",
    answeredAt: sequence,
    topic: "work",
    subtopic: "meetings",
    level: 5,
    prompt: "会議を始めましょう。",
    ...overrides,
  };
}

export function makeCardMeta(id: string, overrides: Partial<CardMeta> = {}): CardMeta {
  return {
    id,
    topic: "work",
    subtopic: "meetings",
    level: 5,
    words: 8,
    concepts: [],
    ...overrides,
  };
}

/** An item whose latest first pass, on 2026-09-22 in round r1, was `result`. */
export function makeItemProgress(
  id: string,
  result: AnswerResult,
  overrides: Partial<ItemProgress> = {},
): ItemProgress {
  return {
    item: { kind: "composition", id },
    memory: { box: 1, dueDay: "2026-09-23", lastDay: "2026-09-22", seenCount: 1 },
    okDays: result === "ok" ? ["2026-09-22"] : [],
    mastered: null,
    placement: { topic: "work", subtopic: "meetings" },
    last: { sessionId: "r1", result, elapsedMs: 8_000, answeredAt: 2_000 },
    previous: null,
    ...overrides,
  };
}
