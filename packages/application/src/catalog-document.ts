import {
  countWords,
  type CardContent,
  type RetiredCard,
  type TopicInfo,
} from "@instant-composition/domain";

import type { CatalogSnapshot, LevelInfo } from "./catalog";

/**
 * The file `pnpm catalog:build` writes for one language pair, as ADR-0004 lays
 * it out: items anchored on the target sentence, with what the learner reads
 * localized by first language. Checking that a file has this shape is the
 * adapter's job; everything here assumes it does.
 */

/** A BCP 47 language tag, such as `en` or `ja`. */
export type LanguageTag = string;

/** A concept namespaced by its target language, such as `en:grammar/present-perfect`. */
export type ConceptId = string;

export type Localized<T> = Readonly<Partial<Record<LanguageTag, T>>>;

export interface Localization {
  /** What the learner sees, in their first language. */
  readonly prompt: string;
  /** Written for this first language, by contrast with it. */
  readonly explanation: string;
}

/** A reviewed item: its core and its localizations were stamped as they stand. */
export interface CompositionItem {
  readonly id: string;
  readonly target: LanguageTag;
  /** The model answer. */
  readonly text: string;
  readonly alternatives: readonly string[];
  readonly concepts: readonly ConceptId[];
  readonly level: number;
  readonly topic: string;
  readonly subtopic: string;
  readonly localizations: Localized<Localization>;
}

/** An item edited since its review: no text of it ships until it is stamped again. */
export interface WithdrawnItem {
  readonly id: string;
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly words: number;
}

/** A deleted item, with the prompt it was deleted with. */
export interface TombstoneItem {
  readonly id: string;
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly localizations: Localized<{ readonly prompt: string }>;
}

/** One step of the target's ladder, with its CEFR band and each exam's rough score. */
export interface LevelStep {
  readonly level: number;
  readonly cefr: string;
  readonly exams: Readonly<Record<string, string | null>>;
}

export interface ConceptEntry {
  readonly id: ConceptId;
  readonly names: Localized<string>;
}

export interface TopicEntry {
  readonly id: string;
  readonly names: Localized<string>;
  readonly subtopics: readonly {
    readonly id: string;
    readonly names: Localized<string>;
  }[];
}

export interface CatalogDocument {
  readonly format: 1;
  /** `sha256:<hex>` over the rest of the document. */
  readonly version: string;
  readonly target: LanguageTag;
  readonly l1: LanguageTag;
  readonly levels: readonly LevelStep[];
  readonly concepts: readonly ConceptEntry[];
  readonly topics: readonly TopicEntry[];
  readonly items: readonly CompositionItem[];
  readonly withdrawn: readonly WithdrawnItem[];
  readonly tombstones: readonly TombstoneItem[];
}

function topicsFor(topics: readonly TopicEntry[], l1: LanguageTag): TopicInfo[] {
  return topics.map((topic) => ({
    id: topic.id,
    name: topic.names[l1] ?? topic.id,
    subtopics: topic.subtopics.map((subtopic) => ({
      id: subtopic.id,
      name: subtopic.names[l1] ?? subtopic.id,
    })),
  }));
}

function levelsOf(steps: readonly LevelStep[]): Map<number, LevelInfo> {
  return new Map(
    steps.map((step) => [
      step.level,
      { cefr: step.cefr, toeic: step.exams["toeic"] ?? "" },
    ]),
  );
}

/**
 * The snapshot a learner whose first language is `l1` is served. An item with
 * no `l1` localization is not shown to them, but an answer may still name it.
 */
export function catalogSnapshotOf(
  document: CatalogDocument,
  l1: LanguageTag,
): CatalogSnapshot {
  const retired = new Map<string, RetiredCard>();
  for (const tombstone of document.tombstones) {
    const { id, topic, subtopic, level } = tombstone;
    const prompt = tombstone.localizations[l1]?.prompt ?? null;
    retired.set(id, { id, topic, subtopic, level, words: null, prompt });
  }
  for (const { id, topic, subtopic, level, words } of document.withdrawn) {
    retired.set(id, { id, topic, subtopic, level, words, prompt: null });
  }
  const shown = new Map<string, CardContent>();
  for (const item of document.items) {
    const { id, topic, subtopic, level, text, alternatives } = item;
    const words = countWords(text);
    const localization = item.localizations[l1];
    if (localization === undefined) {
      retired.set(id, { id, topic, subtopic, level, words, prompt: null });
      continue;
    }
    const { prompt, explanation } = localization;
    shown.set(id, {
      id,
      topic,
      subtopic,
      level,
      words,
      prompt,
      text,
      alternatives,
      explanation,
    });
  }
  return {
    version: document.version,
    topics: topicsFor(document.topics, l1),
    levels: levelsOf(document.levels),
    shown,
    retired,
  };
}
