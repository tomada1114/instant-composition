import type { Growth, GrowthRow } from "./growth";
import type { ItemProgress, ReviewEntry } from "./records";
import { TUNING } from "./tuning";

/**
 * This round's first-pass answers against each item's previous first pass from
 * an earlier round, read off the item's projection rather than the whole log.
 *
 * @remarks
 * An item a later round has already answered again no longer holds this
 * round's predecessor, and counts as seen for the first time.
 */
export function growthOf(
  roundId: string,
  reviews: readonly ReviewEntry[],
  items: ReadonlyMap<string, ItemProgress>,
  shown: ReadonlySet<string>,
): Growth {
  let compared = 0;
  let firstTime = 0;
  const rows: GrowthRow[] = [];
  for (const review of reviews) {
    if (
      review.sessionId !== roundId ||
      review.detail.pass !== "first" ||
      !shown.has(review.item.id)
    ) {
      continue;
    }
    const progress = items.get(review.item.id);
    const previous = progress?.last?.sessionId === roundId ? progress.previous : null;
    if (previous === null) {
      firstTime += 1;
      continue;
    }
    compared += 1;
    if (review.detail.result !== "ok") {
      continue;
    }
    const deltaMs = previous.elapsedMs - review.detail.elapsedMs;
    const row = { cardId: review.item.id, ja: review.snapshot.prompt, deltaMs };
    if (previous.result !== "ok") {
      rows.push({ ...row, kind: "fixed" });
    } else if (deltaMs >= TUNING.growth.fasterThresholdMs) {
      rows.push({ ...row, kind: "faster" });
    }
  }
  rows.sort((a, b) => b.deltaMs - a.deltaMs);
  return {
    faster: rows.filter((row) => row.kind === "faster").length,
    fixed: rows.filter((row) => row.kind === "fixed").length,
    compared,
    firstTime,
    rows,
  };
}
