import * as z from "zod";

import { countWords } from "../../core/timer";
import type { CardContent, TombstoneMeta, TopicInfo } from "../../core/types";
import { isShown } from "../../../scripts/cards/schema.mjs";

const cardSchema = z.object({
  id: z.string().min(1),
  ja: z.string().min(1),
  en: z.string().min(1),
  alternatives: z.array(z.string()),
  point: z.string(),
  topic: z.string().min(1),
  subtopic: z.string().min(1),
  level: z.int().min(1).max(10),
  grammar: z.array(z.string()),
  stamps: z.unknown(),
});

const taxonomySchema = z.object({
  topics: z.array(
    z.object({
      id: z.string(),
      ja: z.string(),
      subtopics: z.array(z.object({ id: z.string(), ja: z.string() })),
    }),
  ),
});

const levelsSchema = z.object({
  levels: z.array(z.object({ level: z.int(), toeic: z.string() })),
});

const tombstoneSchema = z.object({
  id: z.string().min(1),
  ja: z.string(),
  topic: z.string(),
  subtopic: z.string(),
  level: z.int(),
});

export interface ParsedCard {
  readonly card: CardContent;
  readonly shown: boolean;
}

/** One card, or `undefined` for anything that does not have a card's shape. */
export function parseCard(value: unknown): ParsedCard | undefined {
  const parsed = cardSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const { id, ja, en, alternatives, point, topic, subtopic, level } = parsed.data;
  return {
    card: {
      id,
      ja,
      en,
      alternatives,
      point,
      topic,
      subtopic,
      level,
      words: countWords(en),
    },
    shown: isShown(parsed.data),
  };
}

export function parseTaxonomy(value: unknown): TopicInfo[] | undefined {
  const parsed = taxonomySchema.safeParse(value);
  return parsed.success
    ? parsed.data.topics.map((topic) => ({
        id: topic.id,
        ja: topic.ja,
        subtopics: topic.subtopics.map(({ id, ja }) => ({ id, ja })),
      }))
    : undefined;
}

export function parseLevels(value: unknown): Map<number, string> | undefined {
  const parsed = levelsSchema.safeParse(value);
  return parsed.success
    ? new Map(parsed.data.levels.map((entry) => [entry.level, entry.toeic]))
    : undefined;
}

export function parseTombstone(value: unknown): TombstoneMeta | undefined {
  const parsed = tombstoneSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
