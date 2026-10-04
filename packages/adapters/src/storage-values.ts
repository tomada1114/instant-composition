import type { Entry } from "@instant-composition/application";

/** The same discriminated value type is used by every adapter read seam. */
export type ValueOf<T extends Entry["type"]> = Extract<Entry, { type: T }>["value"];
