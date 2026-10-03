import type {
  VocabCard,
  VocabHub,
  VocabSession,
  VocabSummary,
} from "@instant-composition/web";
export function vocabHub(overrides: Partial<VocabHub> = {}): VocabHub {
  return {
    empty: false,
    extra: 10,
    today: { due: 12, new: 10, minutes: 4 },
    categories: [
      {
        category: "word",
        due: 5,
        new: 3,
        learning: 25,
        total: 120,
        extra: 10,
        weak: 3,
      },
      {
        category: "idiom",
        due: 4,
        new: 3,
        learning: 12,
        total: 80,
        extra: 10,
        weak: 2,
      },
      {
        category: "phrasal-verb",
        due: 3,
        new: 4,
        learning: 8,
        total: 60,
        extra: 10,
        weak: 2,
      },
      {
        category: "phrase",
        due: 0,
        new: 0,
        learning: 5,
        total: 40,
        extra: 10,
        weak: 0,
      },
    ],
    weak: 7,
    tomorrow: 14,
    ...overrides,
  };
}
export function vocabCard(
  id = "v_card0001",
  overrides: Partial<VocabCard> = {},
): VocabCard {
  return {
    id,
    category: "phrase",
    level: 4,
    definition: `Say this to reassure someone ${id}.`,
    example: "A: Sorry I'm late.\nB: {{No worries}}. We just started.",
    headword: `No worries ${id}`,
    meaning: "気にしないで",
    example2: "No worries. Everything is ready.",
    intervals: { again: 1, hard: 3, good: 8 },
    isNew: false,
    personal: false,
    ...overrides,
  };
}
export function vocabSession(overrides: Partial<VocabSession> = {}): VocabSession {
  return {
    sessionId: "session-1",
    kind: "today",
    category: null,
    day: "2026-10-02",
    cards: [vocabCard()],
    ...overrides,
  };
}
export function vocabSummary(overrides: Partial<VocabSummary> = {}): VocabSummary {
  return {
    sessionId: "session-1",
    kind: "today",
    category: null,
    day: "2026-10-02",
    answered: 1,
    new: 0,
    again: [],
    tomorrow: 14,
    ...overrides,
  };
}
