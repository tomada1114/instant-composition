import type { ReviewPage } from "@instant-composition/application";

import type { Slot } from "./storage-memory";
import { memoryRow } from "./memory-state";
import { decodeStorageRow } from "./storage-schema";
import type { ReviewEntry } from "@instant-composition/domain";
import { reviewsPrefix } from "./keys";
import { REVIEW_PAGE_SIZE } from "./review-page";

export function memoryReviewPage(
  slots: ReadonlyMap<string, Slot>,
  sessionId: string,
  cursor: string | null,
): ReviewPage {
  const prefix = reviewsPrefix(sessionId);
  if (cursor !== null && !cursor.startsWith(prefix)) {
    throw new RangeError("A review cursor belongs to its round.");
  }
  const keys = [...slots.keys()]
    .filter((key) => key.startsWith(prefix) && (cursor === null || key > cursor))
    .sort();
  const page = keys.slice(0, REVIEW_PAGE_SIZE);
  return {
    entries: page.flatMap((key) => {
      const slot = slots.get(key);
      return slot?.entry.type === "review"
        ? [decodeStorageRow("review", memoryRow(slot, key)).value as ReviewEntry]
        : [];
    }),
    cursor: keys.length > REVIEW_PAGE_SIZE ? (page.at(-1) ?? null) : null,
  };
}
