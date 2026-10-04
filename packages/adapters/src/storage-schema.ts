import { z } from "zod";
import type { Entry } from "@instant-composition/application";
import { withoutRetired } from "./storage-retired";
import { compositionReadModelSchemas } from "./storage-calendar";
import { readModelSchemas } from "./storage-projections";
import { modelTaskSchema } from "./storage-model-task";
import { compositionSchemas } from "./storage-composition";
import { talkSchema, vocabularySchemas } from "./storage-vocabulary";
import { readModelBootstrapSchema } from "./storage-bootstrap-schema";

/** Optimistic `version` counts writes; this identifies the storage contract. */
export const STORAGE_SCHEMA_VERSION = 1;
export type StorageFamily = Entry["type"] | "identity" | "readModelBootstrap";
export const STORAGE_FAMILIES = [
  "identity",
  "profile",
  "settings",
  "stats",
  "round",
  "review",
  "portion",
  "day",
  "item",
  "talk",
  "vocabItem",
  "vocabSession",
  "vocabReview",
  "card",
] as const satisfies readonly StorageFamily[];
const family = z.enum(STORAGE_FAMILIES);
export type StorageErrorCode = "ERR_STORAGE_SCHEMA_UNKNOWN" | "ERR_STORAGE_SHAPE";

export class StorageSchemaError extends Error {
  readonly code: StorageErrorCode;
  readonly path: string;
  constructor(code: StorageErrorCode, path: string) {
    super("A stored record does not satisfy the supported storage contract.");
    this.name = "StorageSchemaError";
    this.code = code;
    this.path = path;
  }
}

/** JSON decoding omits absent optional fields; zod permits explicit undefined. */
type WireCompatible<T> = T extends readonly (infer V)[]
  ? readonly WireCompatible<V>[]
  : T extends object
    ? {
        readonly [K in keyof T]:
          WireCompatible<T[K]> | (undefined extends T[K] ? undefined : never);
      }
    : T;
type FamilyValue<K extends StorageFamily> = K extends "identity"
  ? { readonly learnerId: string }
  : K extends "stats"
    ? Omit<Extract<Entry, { type: "stats" }>["value"], "completedDays"> & {
        readonly completedDays?: readonly string[];
        readonly streak?: { readonly schema: 1; readonly longest: number };
      }
    : K extends Entry["type"]
      ? Extract<Entry, { type: K }>["value"]
      : unknown;
type StorageSchemas = {
  readonly [K in StorageFamily]: z.ZodType<WireCompatible<FamilyValue<K>>>;
};
const schemas = (strict: boolean) => ({
  readModelBootstrap: readModelBootstrapSchema(),
  ...compositionSchemas(strict, STORAGE_SCHEMA_VERSION),
  ...vocabularySchemas(strict),
  talk: talkSchema(strict),
  modelTask: modelTaskSchema(strict),
  ...readModelSchemas(strict),
  ...compositionReadModelSchemas(strict),
});
const CURRENT = schemas(true) satisfies StorageSchemas;
const envelope = z.strictObject({
  type: z.string(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  schemaVersion: z.number().int().nonnegative().optional(),
  value: z.unknown(),
  PK: z.string().min(1).optional(),
  SK: z.string().min(1).optional(),
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});

export interface DecodedStorage {
  readonly type: StorageFamily;
  readonly version: number;
  readonly schemaVersion: number;
  readonly value: unknown;
}

/** Validate every nested field; legacy reads never rewrite the table. */
export function decodeStorageRow(type: StorageFamily, row: unknown): DecodedStorage {
  if (!family.safeParse(type).success)
    throw new StorageSchemaError("ERR_STORAGE_SCHEMA_UNKNOWN", "type");
  const parsed = envelope.safeParse(row);
  if (!parsed.success || parsed.data.type !== type) {
    throw new StorageSchemaError("ERR_STORAGE_SHAPE", "row");
  }
  const { version, schemaVersion = 0, value } = parsed.data;
  if (schemaVersion > STORAGE_SCHEMA_VERSION) {
    throw new StorageSchemaError("ERR_STORAGE_SCHEMA_UNKNOWN", "schemaVersion");
  }
  const decoded = CURRENT[type].safeParse(
    schemaVersion === 0 ? retireKnownFields(type, value) : value,
  );
  if (!decoded.success) {
    throw new StorageSchemaError(
      "ERR_STORAGE_SHAPE",
      decoded.error.issues[0]?.path.join(".") ?? "value",
    );
  }
  if (
    parsed.data.expiresAt !== undefined &&
    (![
      "talk",
      "vocabReadModel",
      "vocabCandidate",
      "compositionReadModel",
      "compositionBuild",
      "compositionCandidate",
    ].includes(type) ||
      Reflect.get(decoded.data, "expiresAt") !== parsed.data.expiresAt)
  )
    throw new StorageSchemaError("ERR_STORAGE_SHAPE", "expiresAt");
  return { type, version, schemaVersion, value: decoded.data };
}

function retireKnownFields(type: StorageFamily, value: unknown): unknown {
  try {
    return withoutRetired(type, value);
  } catch {
    throw new StorageSchemaError("ERR_STORAGE_SHAPE", "retired");
  }
}

/** A write accepts only declared fields and a fully valid current value. */
export function encodeStorageValue(type: StorageFamily, value: unknown): unknown {
  return decodeStorageRow(type, {
    type,
    version: 1,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    value: retireKnownFields(type, value),
  }).value;
}

/** Source fences enumerate supported integer versions. Raising the global storage
 * version preserves prior guarded rows while every older binary refuses future rows.
 */
export function storageSchemaFence(): {
  readonly condition: string;
  readonly values: Readonly<Record<string, number>>;
} {
  const values: Record<string, number> = {
    ":legacy": 0,
    ":schema": STORAGE_SCHEMA_VERSION,
  };
  const terms = [
    "attribute_not_exists(#schema)",
    "#schema = :legacy",
    "#schema = :schema",
  ];
  for (let version = 1; version < STORAGE_SCHEMA_VERSION; version += 1) {
    const name = `:storage${String(version)}`;
    values[name] = version;
    terms.push(`#schema = ${name}`);
  }
  return { condition: `(${terms.join(" OR ")})`, values };
}

/** Infer the family only after checking the envelope's discriminator. */
export function decodeStorageRecord(row: unknown): DecodedStorage {
  const parsed = envelope.safeParse(row);
  if (!parsed.success) throw new StorageSchemaError("ERR_STORAGE_SHAPE", "row");
  const type = family.safeParse(parsed.data.type);
  if (!type.success) throw new StorageSchemaError("ERR_STORAGE_SCHEMA_UNKNOWN", "type");
  return decodeStorageRow(type.data, row);
}
