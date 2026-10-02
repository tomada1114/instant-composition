import * as z from "zod";

import {
  countSchema,
  dayKeySchema,
  gradeSchema,
  idSchema,
  levelSchema,
  passSchema,
  vocabCategorySchema,
} from "./primitives";
import { MAX_ROUND_ANSWERS } from "./requests";

/**
 * The vocabulary activity's requests and answers: `packages/application`'s
 * `vocab-views.ts` and its commands, written as schemas.
 * `tests/contracts-schemas.test.ts` holds each to the type it mirrors.
 */

/** The `{sessionId}` path parameter. */
export const sessionIdParamSchema = idSchema;

export const vocabSessionKindSchema = z.enum(["today", "extra", "weak"]);

/**
 * `POST /v1/vocab/sessions`: the session id is the client's, so a retried
 * start opens one session. A category restricts the deal to its cards.
 */
export const startVocabSessionRequestSchema = z.object({
  sessionId: idSchema,
  kind: vocabSessionKindSchema,
  category: vocabCategorySchema.exactOptional(),
});

/**
 * One graded card; the session comes from the path. `answeredAt` is held
 * between the session's start and the server's time, as a round's answers are.
 */
export const vocabAnswerSchema = z.object({
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  id: idSchema,
  cardId: idSchema,
  pass: passSchema,
  grade: gradeSchema,
  /** Until the flip, recorded and never shown. */
  elapsedMs: z.int().min(0),
  answeredAt: z.int().min(0).exactOptional(),
});

/** `POST /v1/vocab/sessions/{sessionId}/answers` and `…/finish`: a batch, so a replay is the same call. */
export const vocabAnswersRequestSchema = z.object({
  answers: z.array(vocabAnswerSchema).max(MAX_ROUND_ANSWERS),
});

export const vocabCategoryViewSchema = z.object({
  category: vocabCategorySchema,
  due: countSchema,
  new: countSchema,
  learning: countSchema,
  total: countSchema,
});

/** `GET /v1/vocab`: today's queue, each category's share of it, the weak cards and tomorrow. */
export const vocabHubSchema = z.object({
  /** True when the language pair has no vocabulary card at all. */
  empty: z.boolean(),
  today: z.object({ due: countSchema, new: countSchema, minutes: countSchema }),
  categories: z.array(vocabCategoryViewSchema),
  weak: countSchema,
  tomorrow: countSchema,
});

/** Days until the card is due again after each grade, were it given now. */
export const vocabIntervalsSchema = z.object({
  again: countSchema,
  hard: countSchema,
  good: countSchema,
});

export const vocabCardSchema = z.object({
  id: z.string(),
  category: vocabCategorySchema,
  level: levelSchema,
  definition: z.string(),
  /** One sentence, or a two-line `A: …` / `B: …` dialogue, its blanks marked `{{…}}`. */
  example: z.string(),
  headword: z.string(),
  /** In the learner's first language. */
  meaning: z.string(),
  example2: z.string(),
  intervals: vocabIntervalsSchema,
  isNew: z.boolean(),
});

export const vocabSessionSchema = z.object({
  sessionId: z.string(),
  kind: vocabSessionKindSchema,
  category: vocabCategorySchema.nullable(),
  day: dayKeySchema,
  /** The cards dealt, in the order they are shown; empty when nothing is left. */
  cards: z.array(vocabCardSchema),
});

export const vocabAgainRowSchema = z.object({
  cardId: z.string(),
  headword: z.string(),
  meaning: z.string(),
});

export const vocabSummarySchema = z.object({
  sessionId: z.string(),
  kind: vocabSessionKindSchema,
  category: vocabCategorySchema.nullable(),
  day: dayKeySchema,
  answered: countSchema,
  new: countSchema,
  /** The first answers graded again, never a count of misses. */
  again: z.array(vocabAgainRowSchema),
  tomorrow: countSchema,
});
