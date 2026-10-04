import * as z from "zod";
import { countSchema } from "./primitives";
import { MAX_ROUND_ANSWERS } from "./requests";
import {
  vocabAnswerSchema,
  vocabSessionSchema,
  vocabSummarySchema,
  vocabCardSchema,
} from "./vocab";

/** Additive opt-in contract; the original /v1 vocabulary endpoints keep whole decks. */
export const vocabPageRequestSchema = z.object({
  cursor: z
    .string()
    .max(48)
    .regex(/^\d+:\d+$/)
    .nullable(),
  retained: z
    .array(z.object({ page: countSchema, cardId: z.string().min(1).max(200) }))
    .max(16)
    .optional(),
});

export const vocabPreparationSchema = z.object({
  sessionId: z.string(),
  status: z.enum(["building", "ready"]),
  generation: countSchema,
  total: countSchema,
});

export const vocabPageSchema = vocabSessionSchema.extend({
  generation: countSchema,
  page: countSchema,
  total: countSchema,
  cards: z.array(vocabCardSchema.extend({ slot: countSchema })).max(64),
  answered: z.array(z.string()).max(64),
  retained: z
    .array(vocabCardSchema.extend({ slot: countSchema, page: countSchema }))
    .max(16),
  continuation: z.string().nullable(),
});

export const vocabPagedAnswerSchema = vocabAnswerSchema.extend({ page: countSchema });
export const vocabPagedAnswersRequestSchema = z.object({
  generation: countSchema,
  answers: z.array(vocabPagedAnswerSchema).max(MAX_ROUND_ANSWERS),
});

/** Only the first bounded preview is returned; the aggregate counts cover the whole session. */
export const vocabPagedSummarySchema = vocabSummarySchema.extend({
  again: vocabSummarySchema.shape.again.max(32),
  againCount: countSchema,
});
