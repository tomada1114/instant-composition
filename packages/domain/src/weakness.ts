import type { ItemProgress } from "./records";
import { TUNING } from "./tuning";
import type { CardMeta, ConceptId, SubtopicRef } from "./types";

/** What a weakness is judged on: shown items with a first pass, and how many of them were missed. */
export interface WeaknessEvidence {
  readonly seen: number;
  /** Items whose latest first pass was `ng` or a timeout. */
  readonly misses: number;
  /** The smoothed miss rate the ranking sorts on. */
  readonly rate: number;
}

export interface ConceptWeakness extends WeaknessEvidence {
  readonly concept: ConceptId;
}

export interface SubtopicWeakness extends WeaknessEvidence, SubtopicRef {}

/** The weakest first, at most `TUNING.weakness.top` of each. */
export interface Weaknesses {
  /** Only these feed deck composition. */
  readonly grammar: readonly ConceptWeakness[];
  /** For display only: the learner chooses topics, and subtopics are balanced within them. */
  readonly subtopics: readonly SubtopicWeakness[];
}

export interface WeaknessInput {
  readonly items: Iterable<ItemProgress>;
  /** Only the cards shown now; an item not among them is left out. */
  readonly shown: ReadonlyMap<string, CardMeta>;
}

interface Tally<S> {
  readonly subject: S;
  seen: number;
  misses: number;
}

/** `<target>:grammar/<id>`; a lexeme or any other kind of concept is not ranked. */
const GRAMMAR = /^[^:]+:grammar\//;

function count<S>(
  tallies: Map<string, Tally<S>>,
  key: string,
  subject: S,
  missed: boolean,
): void {
  const tally = tallies.get(key) ?? { subject, seen: 0, misses: 0 };
  tally.seen += 1;
  tally.misses += missed ? 1 : 0;
  tallies.set(key, tally);
}

function evidenceOf(tally: Tally<unknown>): WeaknessEvidence {
  const { prior } = TUNING.weakness;
  return {
    seen: tally.seen,
    misses: tally.misses,
    rate: (tally.misses + prior.misses) / (tally.seen + prior.seen),
  };
}

function isWeak(evidence: WeaknessEvidence): boolean {
  return (
    evidence.seen >= TUNING.weakness.minSeen && evidence.rate >= TUNING.weakness.minRate
  );
}

function weakest<S, R>(
  tallies: ReadonlyMap<string, Tally<S>>,
  weakness: (subject: S, evidence: WeaknessEvidence) => R,
): R[] {
  return [...tallies]
    .map(([key, tally]) => ({ key, tally, evidence: evidenceOf(tally) }))
    .filter(({ evidence }) => isWeak(evidence))
    .sort(
      (a, b) =>
        b.evidence.rate - a.evidence.rate ||
        b.evidence.misses - a.evidence.misses ||
        // Keys are distinct; `<` compares code points, so the order ignores the locale.
        (a.key < b.key ? -1 : 1),
    )
    .slice(0, TUNING.weakness.top)
    .map(({ tally, evidence }) => weakness(tally.subject, evidence));
}

/**
 * The learner's weakest grammar concepts and subtopics, by a smoothed miss rate
 * over the shown items they have given a first pass. Derived when read, from each
 * item's projection and the catalog's cards; nothing about it is stored.
 */
export function weaknesses(input: WeaknessInput): Weaknesses {
  const concepts = new Map<string, Tally<ConceptId>>();
  const subtopics = new Map<string, Tally<SubtopicRef>>();
  for (const progress of input.items) {
    const card = input.shown.get(progress.item.id);
    if (card === undefined || progress.last === null) {
      continue;
    }
    const missed = progress.last.result !== "ok";
    for (const concept of new Set(card.concepts)) {
      if (GRAMMAR.test(concept)) {
        count(concepts, concept, concept, missed);
      }
    }
    const place = { topic: card.topic, subtopic: card.subtopic };
    count(subtopics, `${card.topic}/${card.subtopic}`, place, missed);
  }

  return {
    grammar: weakest(concepts, (concept, evidence) => ({ concept, ...evidence })),
    subtopics: weakest(subtopics, (place, evidence) => ({ ...place, ...evidence })),
  };
}

/** The same ranking over incrementally maintained counts. */
export function rankWeaknesses(input: {
  readonly concepts: Iterable<{
    readonly concept: ConceptId;
    readonly seen: number;
    readonly misses: number;
  }>;
  readonly subtopics: Iterable<{
    readonly topic: string;
    readonly subtopic: string;
    readonly seen: number;
    readonly misses: number;
  }>;
}): Weaknesses {
  return {
    grammar: weakest(
      new Map(
        [...input.concepts].map((entry) => [
          entry.concept,
          { subject: entry.concept, seen: entry.seen, misses: entry.misses },
        ]),
      ),
      (concept, evidence) => ({ concept, ...evidence }),
    ),
    subtopics: weakest(
      new Map(
        [...input.subtopics].map((entry) => [
          `${entry.topic}/${entry.subtopic}`,
          {
            subject: { topic: entry.topic, subtopic: entry.subtopic },
            seen: entry.seen,
            misses: entry.misses,
          },
        ]),
      ),
      (place, evidence) => ({ ...place, ...evidence }),
    ),
  };
}
