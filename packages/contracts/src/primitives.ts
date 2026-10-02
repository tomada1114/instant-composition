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

/** Who moves the level: the answers, or nobody but the learner. */
export const levelModeSchema = z.enum(["auto", "manual"]);

export const roundKindSchema = z.enum(["placement", "today", "yesterday", "extra"]);

export const passSchema = z.enum(["first", "retry"]);

/**
 * What an answer counts as: `ok` graded hard or good in time, `ng` graded
 * again, `timeout` the timer ran out first. A client before three grades
 * sends it in place of a grade.
 */
export const answerResultSchema = z.enum(["ok", "ng", "timeout"]);

export const dailySizeSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(30),
]);

/** New drill cards a day may bring: the domain's `TUNING.newPerDay`. */
export const drillNewPerDaySchema = z.union([
  z.literal(0),
  z.literal(3),
  z.literal(5),
  z.literal(10),
  z.literal(15),
]);

/** Drill reviews a day may bring, `null` for no limit: `TUNING.reviewsPerDay`. */
export const drillReviewsPerDaySchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(30),
  z.literal(50),
  z.null(),
]);

/** A per-card time limit on offer, in seconds: the domain's `TUNING.limitSeconds`. */
export const limitSecondsSchema = z.union([
  z.literal(15),
  z.literal(20),
  z.literal(30),
  z.literal(45),
  z.literal(60),
]);

export const subtopicRefSchema = z.object({ topic: idSchema, subtopic: idSchema });

export const dotSchema = z.object({
  day: dayKeySchema,
  state: z.enum(["done", "gap", "missed", "upcoming"]),
});

/**
 * A key the drill may grade with, as a `KeyboardEvent.code`: ↑ ↓ ← →, 0–9 or
 * A–Z, which keeps Space, Enter, Esc and `?` the drill's own. The domain's
 * `isGradeKey` states the same set; `tests/contracts-schemas.test.ts` holds
 * the two together.
 */
export const gradeKeySchema = z
  .string()
  .regex(/^(?:Arrow(?:Up|Down|Left|Right)|Digit[0-9]|Key[A-Z])$/u);

/**
 * One key for ○ and another for ×, as a client before three grades holds
 * them; both on one key is refused. Each grade key set extends it.
 */
export const gradeKeysSchema = z
  .object({ ok: gradeKeySchema, ng: gradeKeySchema })
  .refine((pair) => pair.ok !== pair.ng);

function distinct(keys: {
  ok: string;
  ng: string;
  hard?: string | undefined;
}): boolean {
  return keys.ok !== keys.ng && keys.hard !== keys.ok && keys.hard !== keys.ng;
}

/**
 * The three grade keys as a client reads them: ○ 覚えてた, × 忘れた and △ 微妙,
 * each on its own key. △ is derived for a pair stored before three grades.
 */
export const gradeKeyTrioSchema = z
  .object({ ok: gradeKeySchema, ng: gradeKeySchema, hard: gradeKeySchema })
  .refine(distinct);

/**
 * The grade keys a settings patch sets, all at once: the three, or an older
 * client's pair, whose △ is then derived. A key two grades share is refused.
 */
export const gradeKeysPatchSchema = z
  .object({
    ok: gradeKeySchema,
    ng: gradeKeySchema,
    hard: gradeKeySchema.exactOptional(),
  })
  .refine(distinct);

/** The three self-grades: forgot, unsure and remembered. There is no easy. */
export const gradeSchema = z.enum(["again", "hard", "good"]);

/** Days until a card is due again after each grade, were it given now. */
export const gradeIntervalsSchema = z.object({
  again: countSchema,
  hard: countSchema,
  good: countSchema,
});

/** The four kinds of vocabulary card, in the order the hub lists them. */
export const vocabCategorySchema = z.enum(["word", "idiom", "phrasal-verb", "phrase"]);

/** New vocabulary cards a day may bring: the domain's `VOCAB_TUNING.newPerDay`. */
export const vocabNewPerDaySchema = z.union([
  z.literal(0),
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(30),
]);

/** Vocabulary reviews a day may bring, `null` for no limit: `VOCAB_TUNING.reviewsPerDay`. */
export const vocabReviewsPerDaySchema = z.union([
  z.literal(50),
  z.literal(100),
  z.literal(200),
  z.null(),
]);

export const settingsSchema = z.object({
  topics: z.array(z.string()),
  focus: z.array(subtopicRefSchema),
  /** Read and written for the clients that show it; it no longer sizes a deal. */
  dailySize: dailySizeSchema,
  sound: z.boolean(),
  /** The default until the learner chooses one. */
  limitSeconds: limitSecondsSchema,
  /** →, ← and 2 until the learner chooses keys. */
  gradeKeys: gradeKeyTrioSchema,
  /** 5 until the learner chooses another. */
  newPerDay: drillNewPerDaySchema,
  /** 20 until the learner chooses another; `null` is no limit. */
  reviewsPerDay: drillReviewsPerDaySchema,
  /** 10 until the learner chooses another. */
  vocabNewPerDay: vocabNewPerDaySchema,
  /** 100 until the learner chooses another; `null` is no limit. */
  vocabReviewsPerDay: vocabReviewsPerDaySchema,
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
  pending: countSchema.exactOptional(),
});
