import type { Entry, Stored } from "@instant-composition/application";
import type { ReviewEntry } from "@instant-composition/domain";

import { declaredValue } from "./declared";

// How the DynamoDB store reads a learner table item back: the value an entry
// was written with, and the version beside it.

export type Row = Readonly<Record<string, unknown>>;
export type ValueOf<T extends Entry["type"]> = Extract<Entry, { type: T }>["value"];

/**
 * A row of `type` as the port hands it back. Only this adapter writes the
 * table, so the value is trusted beyond holding only its declared fields.
 */
export function storedOf<T extends Entry["type"]>(
  type: T,
  row: Row,
): Stored<ValueOf<T>> {
  const { value, version } = row;
  if (typeof version !== "number" || typeof value !== "object" || value === null) {
    throw new TypeError("A learner table item has no value or no version.");
  }
  return { value: declaredValue({ type, value } as Entry) as ValueOf<T>, version };
}

/** The fields both logs sort by. */
type Timed = Pick<ReviewEntry, "answeredAt" | "id">;

export function byTime(a: Timed, b: Timed): number {
  return a.answeredAt - b.answeredAt || a.id.localeCompare(b.id);
}
