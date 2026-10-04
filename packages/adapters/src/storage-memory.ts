import type { Entry, Stored } from "@instant-composition/application";
import { decodeStorageRow } from "./storage-schema";

export interface Slot {
  readonly entry: Entry;
  readonly version: number;
  readonly schemaVersion: number;
}
export type ValueOf<T extends Entry["type"]> = Extract<Entry, { type: T }>["value"];

/** Copies only a value already validated by the write decoder. */
export function copyEntry(entry: {
  readonly type: Entry["type"];
  readonly value: unknown;
}): Entry {
  const copy: unknown = JSON.parse(JSON.stringify(entry));
  return copy as Entry;
}

export function readMemorySlot<T extends Entry["type"]>(
  type: T,
  slot: Slot,
): Stored<ValueOf<T>> {
  const copy: unknown = JSON.parse(JSON.stringify(slot.entry));
  const row =
    typeof copy === "object" && copy !== null
      ? { ...copy, version: slot.version, schemaVersion: slot.schemaVersion }
      : copy;
  const decoded = decodeStorageRow(type, row);
  return { value: decoded.value as ValueOf<T>, version: decoded.version };
}
