import * as z from "zod";

/**
 * The values several request and response schemas share. A client-made id is
 * bounded, so a body cannot carry an unbounded string into a store key.
 */

export const idSchema = z.string().min(1).max(64);

/**
 * A practice day, `YYYY-MM-DD`, shifted by the learner's day boundary. A plain
 * pattern rather than `z.iso.date()`, whose calendar-checking pattern would be
 * copied into every place the document names a day.
 */
export const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const countSchema = z.int().min(0);

/** A card level on the catalog's scale, starting at 1. */
export const levelSchema = z.int().min(1);

export const roundKindSchema = z.enum(["placement", "today", "yesterday", "extra"]);

export const passSchema = z.enum(["first", "retry"]);

export const answerResultSchema = z.enum(["ok", "ng", "timeout"]);

export const dailySizeSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(30),
]);

export const subtopicRefSchema = z.object({ topic: idSchema, subtopic: idSchema });

export const dotSchema = z.object({
  day: dayKeySchema,
  state: z.enum(["done", "gap", "missed", "upcoming"]),
});

export const settingsSchema = z.object({
  topics: z.array(z.string()),
  focus: z.array(subtopicRefSchema),
  dailySize: dailySizeSchema,
  sound: z.boolean(),
});

export const ringProgressSchema = z.object({
  from: countSchema,
  to: countSchema,
  done: countSchema,
  span: countSchema,
});

export const reachTopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  count: countSchema,
  added: countSchema,
  ring: ringProgressSchema,
});

export const reachViewSchema = z.object({
  topics: z.array(reachTopicSchema),
  nearest: z.object({ name: z.string(), remaining: countSchema }).nullable(),
});
