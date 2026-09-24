import * as z from "zod";

import {
  answerResultSchema,
  countSchema,
  dayKeySchema,
  dotSchema,
  levelSchema,
  passSchema,
  reachViewSchema,
  roundKindSchema,
  settingsSchema,
  subtopicRefSchema,
} from "./primitives";

/**
 * What a command answers with: `packages/application`'s `views.ts`, written as
 * schemas. `tests/contracts-schemas.test.ts` holds each to the type it mirrors.
 */

export const drillCardSchema = z.object({
  id: z.string(),
  topic: z.string(),
  subtopic: z.string(),
  level: levelSchema,
  words: countSchema,
  prompt: z.string(),
  /** The model answer, in the target language. */
  text: z.string(),
  alternatives: z.array(z.string()),
  explanation: z.string(),
  limitMs: countSchema,
});

export const roundPayloadSchema = z.object({
  id: z.string(),
  kind: roundKindSchema,
  day: dayKeySchema,
  portionDay: dayKeySchema.nullable(),
  deck: z.array(z.string()),
  cards: z.record(z.string(), drillCardSchema),
  answered: z.array(
    z.object({ cardId: z.string(), pass: passSchema, result: answerResultSchema }),
  ),
  offset: countSchema,
  total: countSchema,
  retries: z.boolean(),
});

export const growthRowSchema = z.object({
  cardId: z.string(),
  prompt: z.string().nullable(),
  kind: z.enum(["faster", "fixed"]),
  deltaMs: z.int(),
});

export const growthSchema = z.object({
  faster: countSchema,
  fixed: countSchema,
  compared: countSchema,
  firstTime: countSchema,
  rows: z.array(growthRowSchema),
});

export const reviewRowSchema = z.object({
  cardId: z.string(),
  prompt: z.string().nullable(),
});

export const totalsViewSchema = z.object({
  said: countSchema,
  practicedDays: countSchema,
  last14: z.array(z.object({ day: dayKeySchema, count: countSchema })),
  added: countSchema,
});

export const roundSummarySchema = z.object({
  roundId: z.string(),
  kind: roundKindSchema,
  day: dayKeySchema,
  yesterday: z.boolean(),
  placement: z
    .object({ level: levelSchema, toeic: z.string(), first: z.boolean() })
    .nullable(),
  growth: growthSchema,
  review: z.array(reviewRowSchema),
  streak: z.object({
    value: countSchema,
    restart: z.boolean(),
    changed: z.boolean(),
  }),
  week: z.array(dotSchema),
  filled: dayKeySchema.nullable(),
  difficulty: z
    .object({ change: z.enum(["up", "down"]), toeic: z.string() })
    .nullable(),
  reach: reachViewSchema,
  titles: z.array(z.string()),
  topicNames: z.record(z.string(), z.string()),
  points: z.object({ earned: countSchema, total: countSchema }),
  totals: totalsViewSchema,
  portionCompleted: z.boolean(),
  todayOpen: z.boolean(),
  continueToday: z.boolean(),
});

export const settingsViewSchema = z.object({
  settings: settingsSchema,
  removedFocus: z.array(subtopicRefSchema),
  completedToday: z.boolean(),
});
