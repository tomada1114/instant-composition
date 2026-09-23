import * as z from "zod";

import { TUNING } from "./tuning";

/**
 * Request bodies of the JSON API, shared with the browser code that sends
 * them so the two cannot drift. Every free-text field is bounded.
 */

const id = z.string().min(1).max(64);

export const roundKindSchema = z.enum(["placement", "today", "yesterday", "extra"]);

export const startRoundSchema = z.object({ kind: roundKindSchema });

export const answerInputSchema = z.object({
  id,
  roundId: id,
  cardId: id,
  pass: z.enum(["first", "retry"]),
  result: z.enum(["ok", "ng", "timeout"]),
  elapsedMs: z.int().min(0).max(600_000),
});

export type AnswerInput = z.infer<typeof answerInputSchema>;

/** Two passes over the largest deck is the most a round can hold. */
const MAX_ROUND_ANSWERS = Math.max(...TUNING.dailySizes) * 2;

export const finishRoundSchema = z.object({
  roundId: id,
  answers: z.array(answerInputSchema).max(MAX_ROUND_ANSWERS),
});

export const subtopicRefSchema = z.object({ topic: id, subtopic: id });

export const settingsPatchSchema = z.object({
  topics: z.array(id).max(50).optional(),
  focus: z.array(subtopicRefSchema).max(50).optional(),
  dailySize: z
    .union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30)])
    .optional(),
  sound: z.boolean().optional(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
