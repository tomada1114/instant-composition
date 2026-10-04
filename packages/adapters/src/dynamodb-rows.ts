import type { Entry, Stored } from "@instant-composition/application";
import type { ReviewEntry } from "@instant-composition/domain";

import { decodeStorageRow } from "./storage-schema";

// How the DynamoDB store reads a learner table item back: the value an entry
// was written with, and the version beside it.

export type Row = Readonly<Record<string, unknown>>;
export type ValueOf<T extends Entry["type"]> = Extract<Entry, { type: T }>["value"];

/**
 * A versioned row validated at the adapter boundary before the port sees it.
 */
export function storedOf<T extends Entry["type"]>(
  type: T,
  row: Row,
): Stored<ValueOf<T>> {
  const decoded = decodeStorageRow(type, row);
  // The family-specific decoder checked every nested field before narrowing.
  return { value: decoded.value as ValueOf<T>, version: decoded.version };
}

/** The fields both logs sort by. */
type Timed = Pick<ReviewEntry, "answeredAt" | "id">;

export function byTime(a: Timed, b: Timed): number {
  return a.answeredAt - b.answeredAt || a.id.localeCompare(b.id);
}
