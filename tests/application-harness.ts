import {
  createMemoryStores,
  learnerId,
  type ApplicationDeps,
  type Catalog,
  type CatalogSnapshot,
  type LearnerId,
  type MemoryStores,
  type RequestContext,
  type RoundPayload,
} from "@instant-composition/application";
import type { AnswerInput, CardContent } from "@instant-composition/domain";

// A catalog, a clock and a learner for the packages/application command suites.
// Nothing here asserts.

export const TOPICS = ["work", "travel"] as const;
const SUBTOPICS = ["a", "b"] as const;

function card(
  topic: string,
  subtopic: string,
  level: number,
  index: number,
): CardContent {
  const id = `${topic}-${subtopic}-${String(level)}-${String(index)}`;
  return {
    id,
    topic,
    subtopic,
    level,
    words: 8,
    ja: `${id}の文`,
    en: `The sentence for ${id}.`,
    alternatives: [],
    point: "",
  };
}

/** Two topics of two subtopics, three cards at every level from 1 to 10 in each. */
export function makeSnapshot(): CatalogSnapshot {
  const cards = TOPICS.flatMap((topic) =>
    SUBTOPICS.flatMap((subtopic) =>
      Array.from({ length: 10 }, (_, level) =>
        Array.from({ length: 3 }, (__, index) =>
          card(topic, subtopic, level + 1, index),
        ),
      ).flat(),
    ),
  );
  const byId = new Map(cards.map((entry) => [entry.id, entry]));
  return {
    topics: TOPICS.map((topic) => ({
      id: topic,
      ja: `${topic}の話題`,
      subtopics: SUBTOPICS.map((subtopic) => ({
        id: subtopic,
        ja: `${topic}/${subtopic}`,
      })),
    })),
    toeicByLevel: new Map(
      Array.from({ length: 10 }, (_, level) => [level + 1, `${String(level + 1)}00`]),
    ),
    shown: byId,
    known: byId,
    tombstones: new Map(),
  };
}

export function fixedCatalog(snapshot: CatalogSnapshot = makeSnapshot()): Catalog {
  return { snapshot: () => Promise.resolve({ ok: true, value: snapshot }) };
}

export const unreadableCatalog: Catalog = {
  snapshot: () =>
    Promise.resolve({ ok: false, error: { code: "ERR_CONTENT_UNREADABLE" } }),
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
      learner: { id: learner, timeZone: "Asia/Tokyo", dayBoundaryHour: 4, l1: "ja" },
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
