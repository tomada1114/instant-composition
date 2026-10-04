import * as z from "zod";
import type { CompositionCandidate } from "@instant-composition/application";

const candidate = z.strictObject({
  schema: z.literal(1),
  day: z.string(),
  generation: z.string(),
  mode: z.enum(["due", "notDue"]),
  order: z.string(),
  id: z.string(),
  scheduled: z.boolean(),
  recall: z.number(),
  at: z.number(),
  expiresAt: z.number().int().nonnegative().optional(),
});
export function declaredCompositionCandidate(
  value: CompositionCandidate,
): CompositionCandidate {
  const { expiresAt, ...checked } = candidate.parse(value);
  return { ...checked, ...(expiresAt === undefined ? {} : { expiresAt }) };
}
