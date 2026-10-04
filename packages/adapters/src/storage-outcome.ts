import { z } from "zod";
import { count, day, id, number, object, text } from "./storage-common";

function makeOutcomeSchema(strict: boolean) {
  const row = object({ cardId: id, prompt: text.nullable() }, strict);
  return object(
    {
      placement: object({ level: count, first: z.boolean() }, strict).nullable(),
      difficulty: object(
        { change: z.enum(["up", "down"]), level: count },
        strict,
      ).nullable(),
      growth: object(
        {
          faster: count,
          fixed: count,
          compared: count,
          firstTime: count,
          rows: z.array(
            object(
              {
                cardId: id,
                prompt: text.nullable(),
                kind: z.enum(["faster", "fixed"]),
                deltaMs: number,
              },
              strict,
            ),
          ),
        },
        strict,
      ),
      review: z.array(row),
      streak: object(
        { value: count, restart: z.boolean(), changed: z.boolean() },
        strict,
      ),
      week: z.array(
        object({ day, state: z.enum(["done", "gap", "missed", "upcoming"]) }, strict),
      ),
      filled: day.nullable(),
      reach: z.array(object({ topic: id, count, added: count }, strict)),
      pending: count.optional(),
      titles: z.array(id),
      points: object({ earned: count, total: count }, strict),
      totals: object(
        {
          said: count,
          practicedDays: count,
          added: count,
          last14: z.array(object({ day, count }, strict)),
        },
        strict,
      ),
      portionCompleted: z.boolean(),
      todayOpen: z.boolean(),
      continueToday: z.boolean(),
    },
    strict,
  );
}

export function outcomeSchema(strict: boolean): ReturnType<typeof makeOutcomeSchema> {
  return makeOutcomeSchema(strict);
}
