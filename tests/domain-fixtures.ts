import type { AnswerRecord, CardMeta } from "@instant-composition/domain";

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
  return { id, topic: "work", subtopic: "meetings", level: 5, words: 8, ...overrides };
}
