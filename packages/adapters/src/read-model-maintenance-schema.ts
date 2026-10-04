import { z } from "zod";
import {
  learnerId,
  type MaintenanceCheckpoint,
} from "@instant-composition/application";

const profile = z.object({
  timeZone: z.string().min(1),
  l1: z.string().min(1),
  target: z.string().min(1),
  uiLocale: z.string().min(1),
});
const checkpoint = z
  .object({
    schema: z.literal(1),
    cursor: z.string().nullable(),
    pending: z.array(z.object({ id: z.string().min(1), profile })).max(100),
    index: z.number().int().min(0).max(101),
    passCompletedAt: z.number().int().nonnegative().nullable(),
  })
  .refine((value) => value.index <= value.pending.length + 1);

/** Unknown generations/checkpoints fail closed before any trusted learner work is selected. */
export function maintenanceCheckpointOf(value: unknown): MaintenanceCheckpoint {
  const parsed = checkpoint.parse(value);
  return {
    ...parsed,
    pending: parsed.pending.map((learner) => ({
      ...learner,
      id: learnerId(learner.id),
    })),
  };
}
