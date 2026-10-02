import { createMemoryStores, type MemoryStores } from "@instant-composition/adapters";
import {
  learnerId,
  type ApplicationDeps,
  type Catalog,
  type CatalogSnapshot,
  type LearnerId,
  type RequestContext,
  type RoundPayload,
  type VocabCategory,
  type VocabItem,
} from "@instant-composition/application";
import type { AnswerInput, CardContent } from "@instant-composition/domain";

// A catalog, a clock and a learner for the packages/application command suites.
// Nothing here asserts.

export const TOPICS = ["work", "travel"] as const;
const CONCEPT = "en:grammar/imperatives";
const SUBTOPICS = ["a", "b"] as const;

function card(
  topic: string,
  subtopic: string,
  level: number,
  index: number,
  concept: string,
): CardContent {
  const id = `${topic}-${subtopic}-${String(level)}-${String(index)}`;
  return {
    id,
    topic,
    subtopic,
    level,
    words: 8,
    concepts: [concept],
    prompt: `${id}の文`,
    text: `The sentence for ${id}.`,
    alternatives: [],
    explanation: "",
  };
}

export interface SnapshotOptions {
  /** Cards at every level of every subtopic; three unless given. */
  readonly perLevel?: number;
  /** Handed out in turn by a card's index within its level; one concept unless given. */
  readonly concepts?: readonly string[];
  /** The vocabulary cards; {@link makeVocab}'s forty unless given. */
  readonly vocab?: readonly VocabItem[];
}

const CATEGORIES: readonly VocabCategory[] = [
  "word",
  "idiom",
  "phrasal-verb",
  "phrase",
];

/** One vocabulary card, its fields derived from its id. */
export function vocabItem(
  category: VocabCategory,
  level: number,
  index: number,
): VocabItem {
  const id = `v_${category}-${String(level)}-${String(index)}`;
  return {
    id,
    target: "en",
    category,
    level,
    headword: `headword ${id}`,
    definition: `What ${id} means.`,
    example: `An example of {{headword}} for ${id}.`,
    example2: `Another example for ${id}.`,
    meaning: `${id}の意味`,
  };
}

/**
 * Forty vocabulary cards laid out as the starter cards are: ten per category,
 * two at each level from 3 to 7, in id order as the catalog build sorts them.
 */
export function makeVocab(): VocabItem[] {
  return CATEGORIES.flatMap((category) =>
    [3, 4, 5, 6, 7].flatMap((level) =>
      [0, 1].map((index) => vocabItem(category, level, index)),
    ),
  ).sort((a, b) => a.id.localeCompare(b.id));
}

/** Two topics of two subtopics, three cards at every level from 1 to 10 in each. */
export function makeSnapshot(options: SnapshotOptions = {}): CatalogSnapshot {
  const concepts = options.concepts ?? [CONCEPT];
  const cards = TOPICS.flatMap((topic) =>
    SUBTOPICS.flatMap((subtopic) =>
      Array.from({ length: 10 }, (_, level) =>
        Array.from({ length: options.perLevel ?? 3 }, (__, index) =>
          card(
            topic,
            subtopic,
            level + 1,
            index,
            concepts[index % concepts.length] ?? CONCEPT,
          ),
        ),
      ).flat(),
    ),
  );
  const byId = new Map(cards.map((entry) => [entry.id, entry]));
  return {
    version: "sha256:fixture",
    target: "en",
    l1: "ja",
    topics: TOPICS.map((topic) => ({
      id: topic,
      name: `${topic}の話題`,
      subtopics: SUBTOPICS.map((subtopic) => ({
        id: subtopic,
        name: `${topic}/${subtopic}`,
      })),
    })),
    levels: new Map(
      Array.from({ length: 10 }, (_, level) => [
        level + 1,
        { cefr: "B1", toeic: `${String(level + 1)}00` },
      ]),
    ),
    conceptNames: new Map(
      concepts.map((concept) => [concept, concept === CONCEPT ? "命令文" : concept]),
    ),
    shown: byId,
    retired: new Map(),
    vocab: new Map((options.vocab ?? makeVocab()).map((item) => [item.id, item])),
  };
}

export function fixedCatalog(snapshot: CatalogSnapshot = makeSnapshot()): Catalog {
  return { snapshot: () => Promise.resolve({ ok: true, value: snapshot }) };
}

export const unreadableCatalog: Catalog = {
  snapshot: () =>
    Promise.resolve({
      ok: false,
      error: { code: "ERR_CONTENT_UNREADABLE", reason: "missing" },
    }),
};

/** 2026-09-22 at 12:00 in Tokyo. */
export const NOON = Date.UTC(2026, 8, 22, 3, 0);
export const DAY_MS = 86_400_000;

export interface Harness {
  readonly stores: MemoryStores;
  readonly deps: ApplicationDeps;
  readonly learner: LearnerId;
  context(now?: number): RequestContext;
}

export function makeHarness(catalog: Catalog = fixedCatalog()): Harness {
  const stores = createMemoryStores();
  const learner = learnerId("learner-a");
  return {
    stores,
    deps: { stores, catalog },
    learner,
    context: (now = NOON) => ({
      actor: { kind: "learner", learnerId: learner },
      learner: {
        id: learner,
        timeZone: "Asia/Tokyo",
        dayBoundaryHour: 4,
        l1: "ja",
        target: "en",
        uiLocale: "ja",
      },
      now,
      requestId: "req",
    }),
  };
}

/** Answers for every card of the deck's first pass, each graded by `grade`. */
export function answersFor(
  round: RoundPayload,
  grade: (cardId: string, index: number) => AnswerInput["result"] = () => "ok",
  elapsedMs = 3_000,
): AnswerInput[] {
  return round.deck.map((cardId, index) => ({
    id: `${round.id}:f:${cardId}`,
    roundId: round.id,
    cardId,
    pass: "first",
    result: grade(cardId, index),
    elapsedMs,
  }));
}
