import { z } from "zod";
import type { Entry } from "@instant-composition/application";

const category = z.enum(["word", "idiom", "phrasal-verb", "phrase"]);
const natural = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const counts = z.object({
  category,
  total: natural,
  learning: natural,
  due: natural,
  fresh: natural,
  weak: natural,
  tomorrow: natural,
  introduced: natural,
  reviewed: natural,
});
const source = z.object({ schema: z.literal(1) });
const model = z.object({
  expiresAt: natural.optional(),
  schema: z.literal(1),
  day,
  catalog: z.string(),
  generation: z.string().min(1),
  sourceVersion: natural,
  status: z.enum(["building", "ready"]),
  phase: z.enum(["catalog", "personal"]),
  offset: natural,
  cursor: z.string().nullable(),
  counts: z
    .array(counts)
    .length(4)
    .refine((rows) => new Set(rows.map((row) => row.category)).size === 4),
});
const candidate = z.object({
  expiresAt: natural.optional(),
  schema: z.literal(1),
  day,
  generation: z.string().min(1),
  mode: z.enum(["due", "weak", "fresh", "freshLower", "freshWeak"]),
  category: category.nullable(),
  level: z.number().int().min(1).nullable(),
  order: z.string().min(1),
  cardId: z.string().min(1),
  cardCategory: category,
  cardLevel: z.number().int().min(1),
  kind: z.enum(["new", "review"]),
});

/** Persisted read models are versioned data; an unknown shape never becomes an empty projection. */
export function declaredReadModel(
  entry: Extract<
    Entry,
    {
      readonly type:
        | "readModelSource"
        | "vocabReadModel"
        | "vocabCandidate"
        | "vocabReadModelRequest";
    }
  >,
): Entry["value"] {
  switch (entry.type) {
    case "vocabReadModelRequest":
      return z.object({ schema: z.literal(1), day }).parse(entry.value);
    case "readModelSource":
      return source.parse(entry.value);
    case "vocabReadModel":
      return model.parse(entry.value);
    case "vocabCandidate":
      return candidate.parse(entry.value);
  }
}
