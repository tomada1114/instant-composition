import { z } from "zod";

export const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const number = z.number();
export const text = z.string();
export const id = text.min(1);
export const day = text.regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const result = z.enum(["ok", "ng", "timeout"]);
export const grade = z.enum(["again", "hard", "good"]);
export const pass = z.enum(["first", "retry"]);
export const category = z.enum(["word", "idiom", "phrasal-verb", "phrase"]);

/** Every admitted schema is strict; retirement is validated at named paths. */
export function object<S extends z.ZodRawShape>(
  shape: S,
  strict: boolean,
): z.ZodObject<S> {
  return strict ? z.strictObject(shape) : z.object(shape);
}

function makeCommonSchemas(strict: boolean) {
  return {
    item: object({ kind: z.literal("composition"), id }, strict),
    placement: object({ topic: id, subtopic: id }, strict),
    memory: object({ box: count, dueDay: day, lastDay: day, seenCount: count }, strict),
    fsrs: object(
      {
        stability: number.positive(),
        difficulty: number.min(1).max(10),
        reps: count,
        lapses: count,
        lastDay: day,
        dueDay: day,
      },
      strict,
    ),
    mark: object(
      { sessionId: id, result, elapsedMs: count, answeredAt: number },
      strict,
    ),
  };
}

export function commonSchemas(strict: boolean): ReturnType<typeof makeCommonSchemas> {
  return makeCommonSchemas(strict);
}
