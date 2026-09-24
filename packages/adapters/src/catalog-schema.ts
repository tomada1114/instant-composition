import type { CatalogDocument } from "@instant-composition/application";
import { z } from "zod";

// What `pnpm catalog:build` writes, checked before anything reads it.
// packages/application's `CatalogDocument` is the type; `parseCatalogDocument`
// returning it is what keeps this schema from drifting away from it.

const text = z.string().min(1);
const level = z.number().int().min(1);
const localized = <T extends z.ZodType>(value: T) => z.record(z.string(), value);

const names = localized(z.string());

const catalogDocument = z.object({
  format: z.literal(1),
  version: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  target: text,
  l1: text,
  levels: z.array(
    z.object({
      level,
      cefr: z.string(),
      exams: z.record(z.string(), z.string().nullable()),
    }),
  ),
  concepts: z.array(z.object({ id: text, names })),
  topics: z.array(
    z.object({
      id: text,
      names,
      subtopics: z.array(z.object({ id: text, names })),
    }),
  ),
  items: z.array(
    z.object({
      id: text,
      target: text,
      text,
      alternatives: z.array(z.string()),
      concepts: z.array(text),
      level,
      topic: text,
      subtopic: text,
      localizations: localized(z.object({ prompt: text, explanation: z.string() })),
    }),
  ),
  withdrawn: z.array(
    z.object({
      id: text,
      topic: text,
      subtopic: text,
      level,
      words: z.number().int().nonnegative(),
    }),
  ),
  tombstones: z.array(
    z.object({
      id: text,
      topic: text,
      subtopic: text,
      level,
      localizations: localized(z.object({ prompt: text })),
    }),
  ),
});

/** The document `value` holds, or `undefined` when it does not have the snapshot's shape. */
export function parseCatalogDocument(value: unknown): CatalogDocument | undefined {
  const parsed = catalogDocument.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
