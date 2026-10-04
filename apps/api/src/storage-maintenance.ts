import {
  decodeStorageRecord,
  encodeStorageValue,
  StorageSchemaError,
  STORAGE_SCHEMA_VERSION,
} from "@instant-composition/adapters";

export type MaintenanceAnswer =
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | {
      readonly ok: false;
      readonly code: "ERR_STORAGE_SHAPE" | "ERR_STORAGE_SCHEMA_UNKNOWN";
    };

/** Maintenance uses the same boundary decoder as live reads, without an HTTP route. */
export function validateStoredRecords(input: unknown): MaintenanceAnswer {
  if (!Array.isArray(input) || input.length > 100)
    return { ok: false, code: "ERR_STORAGE_SHAPE" };
  try {
    const rows = input.map((row: unknown) => {
      const decoded = decodeStorageRecord(row);
      return {
        ...decoded,
        targetSchema: STORAGE_SCHEMA_VERSION,
        targetValue: encodeStorageValue(decoded.type, decoded.value),
      };
    });
    return { ok: true, rows };
  } catch (error) {
    if (!(error instanceof StorageSchemaError)) throw error;
    return { ok: false, code: error.code };
  }
}
