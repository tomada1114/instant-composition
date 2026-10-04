import { z } from "zod";
import type { ReadModelBootstrapState } from "@instant-composition/application";
import { count, id } from "./storage-common";
import { StorageSchemaError } from "./storage-schema";

const phase = z.enum(["discovery", "preparation", "verification"]);
const cursor = id.max(4096).refine((value) => {
  try {
    const decoded: unknown = JSON.parse(value);
    return z.strictObject({ PK: id, SK: id }).safeParse(decoded).success;
  } catch {
    return false;
  }
});
const position = z
  .strictObject({
    schema: z.literal(1),
    phase,
    catalog: id,
    cursor: cursor.nullable(),
    validUntil: count.nullable(),
  })
  .refine(
    (value) =>
      value.phase === "verification" ||
      (value.validUntil === null &&
        (value.phase !== "preparation" || value.cursor === null)),
  );
const state = z
  .strictObject({
    schema: z.literal(1),
    release: z.strictObject({
      sha: z.string().regex(/^[a-f0-9]{40}$/u),
      contract: id,
      schemaFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
    catalog: id,
    checkpoint: id.max(8192).nullable(),
    validUntil: count.nullable(),
    maintenanceVersion: count.positive().nullable(),
    complete: z.boolean(),
    phase,
    rows: count,
    learners: count,
  })
  .refine((value) => {
    if (value.complete)
      return value.phase === "verification" && value.checkpoint === null;
    if (value.checkpoint === null) return false;
    try {
      const parsed: unknown = JSON.parse(value.checkpoint);
      const decoded = position.safeParse(parsed);
      return (
        decoded.success &&
        decoded.data.catalog === value.catalog &&
        decoded.data.phase === value.phase &&
        decoded.data.validUntil === value.validUntil
      );
    } catch {
      return false;
    }
  });

/** Shape prepared for cap4; the initial guard still refuses its row family. */
export function readModelBootstrapSchema(): typeof state {
  return state;
}

export function decodeReadModelBootstrapState(value: unknown): ReadModelBootstrapState {
  const decoded = state.safeParse(value);
  if (!decoded.success) throw new StorageSchemaError("ERR_STORAGE_SHAPE", "bootstrap");
  return decoded.data;
}
