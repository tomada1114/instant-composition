import {
  decodeStorageRow,
  storageSchemaFence,
  StorageSchemaError,
  type DecodedStorage,
  type StorageFamily,
} from "./storage-schema";

export interface StoragePrimaryKey {
  readonly PK: string;
  readonly SK: string;
}
export interface ObservedStorage extends DecodedStorage {
  readonly key: StoragePrimaryKey;
  readonly rawValue: unknown;
  readonly schemaPresent: boolean;
  readonly expiresAt?: number;
}
export interface ObservedStorageGuard {
  readonly ConditionExpression: string;
  readonly ExpressionAttributeNames: Readonly<Record<string, string>>;
  readonly ExpressionAttributeValues?: Readonly<Record<string, unknown>>;
}

/** The caller performs a strongly consistent read of this exact primary key. */
export function observeStorageRow(
  type: StorageFamily,
  key: StoragePrimaryKey,
  raw: unknown,
): ObservedStorage | undefined {
  if (raw === undefined) return undefined;
  const decoded = decodeStorageRow(type, raw);
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("PK" in raw) ||
    !("SK" in raw) ||
    !("value" in raw) ||
    raw.PK !== key.PK ||
    raw.SK !== key.SK
  )
    throw new StorageSchemaError("ERR_STORAGE_SHAPE", "key");
  const expiry = "expiresAt" in raw ? raw.expiresAt : undefined;
  if (expiry !== undefined && typeof expiry !== "number")
    throw new StorageSchemaError("ERR_STORAGE_SHAPE", "expiresAt");
  return {
    ...decoded,
    key,
    rawValue: raw.value,
    schemaPresent: Object.hasOwn(raw, "schemaVersion"),
    ...(expiry === undefined ? {} : { expiresAt: expiry }),
  };
}

/** Supported-schema admission plus the exact preimage used to prepare a write. */
export function observedStorageGuard(
  source: ObservedStorage | undefined,
): ObservedStorageGuard {
  if (source === undefined)
    return {
      ConditionExpression: "attribute_not_exists(#pk)",
      ExpressionAttributeNames: { "#pk": "PK" },
    };
  const fence = storageSchemaFence(source.type);
  const names = {
    "#version": "version",
    "#schema": "schemaVersion",
    "#type": "type",
    "#value": "value",
    "#expiry": "expiresAt",
  };
  const values: Record<string, unknown> = {
    ...fence.values,
    ":observedVersion": source.version,
    ...(source.schemaPresent ? { ":observedSchema": source.schemaVersion } : {}),
    ":observedFamily": source.type,
    // Strict decoding above establishes the declared DynamoDB wire value.
    ":observedValue": source.rawValue,
  };
  const schema = source.schemaPresent
    ? "#schema = :observedSchema"
    : "attribute_not_exists(#schema)";
  const expiry =
    source.expiresAt === undefined
      ? "attribute_not_exists(#expiry)"
      : "#expiry = :observedExpiry";
  if (source.expiresAt !== undefined) values[":observedExpiry"] = source.expiresAt;
  return {
    ConditionExpression: [
      "#version = :observedVersion",
      "#type = :observedFamily",
      fence.condition,
      schema,
      "#value = :observedValue",
      expiry,
    ].join(" AND "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}
