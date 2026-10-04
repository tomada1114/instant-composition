import { z } from "zod";
import { withoutRetired } from "./storage-retired";
import { storageSchemasAt } from "./storage-history";

import {
  STORAGE_FAMILIES,
  STORAGE_SCHEMA_VERSION,
  storageFamilyBirth,
  type StorageFamily,
} from "./storage-families";
import { storageKeysMatch } from "./storage-key-binding";
export {
  STORAGE_FAMILIES,
  STORAGE_SCHEMA_VERSION,
  type StorageFamily,
} from "./storage-families";
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

const DECLARED = Array.from({ length: STORAGE_SCHEMA_VERSION + 1 }, (_, version) =>
  storageSchemasAt(version),
);
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
  if (
    schemaVersion > STORAGE_SCHEMA_VERSION ||
    schemaVersion < storageFamilyBirth(type)
  ) {
    throw new StorageSchemaError("ERR_STORAGE_SCHEMA_UNKNOWN", "schemaVersion");
  }
  const declared = DECLARED[schemaVersion];
  if (!declared)
    throw new StorageSchemaError("ERR_STORAGE_SCHEMA_UNKNOWN", "schemaVersion");
  const decoded = declared[type].safeParse(
    schemaVersion === 0 ? retireKnownFields(type, value) : value,
  );
  if (!decoded.success) {
    throw new StorageSchemaError(
      "ERR_STORAGE_SHAPE",
      decoded.error.issues[0]?.path.join(".") ?? "value",
    );
  }
  if (!storageKeysMatch(type, decoded.data, parsed.data.PK, parsed.data.SK))
    throw new StorageSchemaError("ERR_STORAGE_SHAPE", "key");
  if (
    parsed.data.expiresAt !== undefined &&
    (![
      "talk",
      "modelTask",
      "vocabReadModel",
      "vocabCandidate",
      "compositionReadModel",
      "compositionBuild",
      "compositionCandidate",
    ].includes(type) ||
      typeof decoded.data !== "object" ||
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
export function storageSchemaFence(type?: StorageFamily): {
  readonly condition: string;
  readonly values: Readonly<Record<string, number>>;
} {
  const first = type === undefined ? 0 : storageFamilyBirth(type);
  const values: Record<string, number> = {};
  const terms: string[] = first === 0 ? ["attribute_not_exists(#schema)"] : [];
  for (let version = first; version <= STORAGE_SCHEMA_VERSION; version += 1) {
    const name =
      version === 0
        ? ":legacy"
        : version === STORAGE_SCHEMA_VERSION
          ? ":schema"
          : `:storage${String(version)}`;
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
