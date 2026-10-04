import { dayDiff, type DayKey, type ItemProgress } from "@instant-composition/domain";
import type { CatalogSnapshot } from "./catalog";
import type { CompositionBuild, RankedCompositionCard } from "./composition-model";
import { rankedCompositionCard } from "./composition-aggregate";
/** Sortable IEEE754 keys preserve finite positive and negative legacy answer times. */
function numericOrder(value: number): string {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  const bits = bytes.getBigUint64(0);
  const sign = 1n << 63n;
  return ((bits & sign) !== 0n ? 0xffffffffffffffffn ^ bits : sign ^ bits)
    .toString(16)
    .padStart(16, "0");
}

export interface CompositionCandidate extends RankedCompositionCard {
  readonly schema: 1;
  readonly day: DayKey;
  readonly generation: string;
  readonly mode: "due" | "notDue";
  readonly order: string;
  readonly expiresAt?: number;
}
export interface CompositionCandidateRequest {
  readonly day: DayKey;
  readonly generation: string;
  readonly mode: "due" | "notDue";
  readonly limit: number;
  readonly cursor: string | null;
}
export function compositionCandidateId(candidate: CompositionCandidate): string {
  return JSON.stringify([
    candidate.day,
    candidate.generation,
    candidate.mode,
    candidate.order,
    candidate.id,
  ]);
}
/** One live candidate per eligible shown item; withdrawn and already answered items have none. */
export function compositionCandidate(
  item: ItemProgress | undefined,
  build: Pick<CompositionBuild, "day" | "generation" | "expiresAt">,
  snapshot: CatalogSnapshot,
  topics: readonly string[],
): CompositionCandidate | undefined {
  if (item === undefined) return undefined;
  const card = snapshot.shown.get(item.item.id);
  if (
    card === undefined ||
    !topics.includes(card.topic) ||
    (item.fsrs?.lastDay ?? item.memory?.lastDay) === build.day
  )
    return undefined;
  const mode =
    item.fsrs === undefined || dayDiff(item.fsrs.dueDay, build.day) >= 0
      ? "due"
      : "notDue";
  const ranked = rankedCompositionCard(item, build.day);
  const idOrder = [...snapshot.shown.keys()]
    .sort((a, b) => a.localeCompare(b))
    .indexOf(ranked.id)
    .toString()
    .padStart(12, "0");
  const order =
    mode === "due"
      ? `${ranked.scheduled ? "0" : "1"}#${numericOrder(ranked.recall)}#${numericOrder(ranked.at)}#${idOrder}`
      : `${numericOrder(ranked.recall)}#${idOrder}`;
  return {
    ...ranked,
    schema: 1,
    day: build.day,
    generation: build.generation,
    mode,
    order,
    ...(build.expiresAt === undefined ? {} : { expiresAt: build.expiresAt }),
  };
}
