import type { SystemRecord } from "./system-record";
import { err, ok } from "@instant-composition/domain";
import { observeStorageRow, type StoragePrimaryKey } from "./storage-observed";
import {
  encodeStorageValue,
  STORAGE_SCHEMA_VERSION,
  type StorageFamily,
} from "./storage-schema";
export type MemorySystemRows = Map<string, Readonly<Record<string, unknown>>>;
export function memorySystemKey(key: StoragePrimaryKey): string {
  return JSON.stringify([key.PK, key.SK]);
}
export function memorySystemRecord<T>(
  rows: MemorySystemRows,
  type: StorageFamily,
  key: StoragePrimaryKey,
  decode: (value: unknown) => T,
): SystemRecord<T> {
  return {
    async checkpoint() {
      const row = observeStorageRow(type, key, rows.get(memorySystemKey(key)));
      return Promise.resolve(
        row === undefined
          ? undefined
          : { value: decode(row.value), version: row.version },
      );
    },
    async save(value: T, version: number | null) {
      const checked = encodeStorageValue(type, value);
      const current = observeStorageRow(type, key, rows.get(memorySystemKey(key)));
      if ((current?.version ?? null) !== version)
        return Promise.resolve(err({ code: "ERR_CONFLICT" } as const));
      rows.set(memorySystemKey(key), {
        ...key,
        type,
        version: (version ?? 0) + 1,
        schemaVersion: STORAGE_SCHEMA_VERSION,
        value: checked,
      });
      return Promise.resolve(ok(undefined));
    },
  };
}
