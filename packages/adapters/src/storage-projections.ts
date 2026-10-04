import { z } from "zod";
import { category, count, day, id, object, text } from "./storage-common";

function projectionSchemas(strict: boolean) {
  const profile = object({ timeZone: id, l1: id, target: id, uiLocale: id }, strict);
  const counts = object(
    {
      category,
      total: count,
      learning: count,
      due: count,
      fresh: count,
      weak: count,
      tomorrow: count,
      introduced: count,
      reviewed: count,
    },
    strict,
  );
  const scanCursor = text.refine((cursor) => {
    try {
      const value: unknown = JSON.parse(cursor);
      return object({ PK: id, SK: id }, true).safeParse(value).success;
    } catch {
      return false;
    }
  });
  return {
    readModelLearner: object({ schema: z.literal(1), id, profile }, strict),
    vocabReadModelRequest: object({ schema: z.literal(1), day }, strict),
    readModelSource: object({ schema: z.literal(1) }, strict),
    vocabReadModel: object(
      {
        schema: z.literal(1),
        day,
        catalog: id,
        generation: id,
        sourceVersion: count,
        expiresAt: count.optional(),
        status: z.enum(["building", "ready"]),
        phase: z.enum(["catalog", "personal"]),
        offset: count,
        cursor: id.nullable(),
        counts: z
          .array(counts)
          .length(4)
          .refine((rows) => new Set(rows.map((row) => row.category)).size === 4),
      },
      strict,
    ),
    vocabCandidate: object(
      {
        schema: z.literal(1),
        day,
        generation: id,
        mode: z.enum(["due", "weak", "fresh", "freshLower", "freshWeak"]),
        category: category.nullable(),
        level: count.nullable(),
        order: id,
        cardId: id,
        cardCategory: category,
        cardLevel: count,
        expiresAt: count.optional(),
        kind: z.enum(["new", "review"]),
      },
      strict,
    ),
    readModelMaintenance: object(
      {
        schema: z.literal(1),
        cursor: scanCursor.nullable(),
        pending: z.array(object({ id, profile }, strict)).max(100),
        index: count,
        passCompletedAt: count.nullable(),
      },
      strict,
    ).refine((value) => value.index <= value.pending.length),
  };
}

export function readModelSchemas(
  strict: boolean,
): ReturnType<typeof projectionSchemas> {
  return projectionSchemas(strict);
}
