import {
  addDays,
  answeredOn,
  dayDiff,
  isNewCard,
  isWeak,
  recallOf,
  VOCAB_TUNING,
  type DayKey,
  type PersonalCard,
  type VocabProgress,
} from "@instant-composition/domain";

import type { CatalogSnapshot } from "./catalog";
import type { VocabCandidate, VocabCounts } from "./read-model";
import type { VocabItem } from "./vocab-item";

export interface ProjectionCard {
  readonly card: VocabItem;
  readonly order: string;
}

export function emptyVocabCounts(): VocabCounts[] {
  return VOCAB_TUNING.categories.map((category) => ({
    category,
    total: 0,
    learning: 0,
    due: 0,
    fresh: 0,
    weak: 0,
    tomorrow: 0,
    introduced: 0,
    reviewed: 0,
  }));
}

/** Sortable binary64 levels also cover valid personal-card levels absent from the catalog. */
export function vocabLevelOrder(value: number, lower = false): string {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, Math.max(0, value));
  const bits = bytes.getBigUint64(0);
  return (lower ? 0xffffffffffffffffn - bits : bits).toString(16).padStart(16, "0");
}

/** Binary64 keys preserve the scheduler's exact comparison, including near ties. */
function recallKey(value: number): string {
  if (value === Number.NEGATIVE_INFINITY) return "0";
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  return `1${bytes.getBigUint64(0).toString(16).padStart(16, "0")}`;
}

export function projectionCard(
  snapshot: CatalogSnapshot,
  id: string,
  personal: PersonalCard | undefined,
): ProjectionCard | undefined {
  if (personal?.target === snapshot.target && personal.l1 === snapshot.l1) {
    return {
      card: personal,
      order: `1${String(personal.createdAt).padStart(16, "0")}#${personal.id}`,
    };
  }
  const card = snapshot.vocab.get(id);
  if (card === undefined) return undefined;
  const ordinal = [...snapshot.vocab.keys()].indexOf(id);
  return { card, order: `0${String(ordinal).padStart(12, "0")}` };
}

function flags(progress: VocabProgress | undefined, day: DayKey) {
  const fresh = isNewCard(progress);
  const answered = answeredOn(progress, day);
  return {
    learning: !fresh,
    fresh: fresh && !answered,
    due:
      !fresh &&
      !answered &&
      progress?.state !== null &&
      progress?.state !== undefined &&
      dayDiff(progress.state.dueDay, day) >= 0,
    weak: isWeak(progress) && !answered,
    tomorrow:
      progress?.state !== null &&
      progress?.state !== undefined &&
      dayDiff(progress.state.dueDay, addDays(day, 1)) >= 0,
    introduced: answered && progress?.firstDay === day,
    reviewed: answered && progress?.firstDay !== day,
  };
}

/** Adds or removes one shown card's contribution, independently of the corpus size. */
export function countVocabCard(
  counts: readonly VocabCounts[],
  shown: ProjectionCard | undefined,
  progress: VocabProgress | undefined,
  day: DayKey,
  sign: 1 | -1,
): VocabCounts[] {
  if (shown === undefined) return [...counts];
  const state = flags(progress, day);
  return counts.map((count) =>
    count.category !== shown.card.category
      ? count
      : {
          category: count.category,
          total: count.total + sign,
          learning: count.learning + sign * Number(state.learning),
          due: count.due + sign * Number(state.due),
          fresh: count.fresh + sign * Number(state.fresh),
          weak: count.weak + sign * Number(state.weak),
          tomorrow: count.tomorrow + sign * Number(state.tomorrow),
          introduced: count.introduced + sign * Number(state.introduced),
          reviewed: count.reviewed + sign * Number(state.reviewed),
        },
  );
}

export function candidateRows(
  shown: ProjectionCard | undefined,
  progress: VocabProgress | undefined,
  day: DayKey,
  generation: string,
  expiresAt?: number,
): VocabCandidate[] {
  if (shown === undefined) return [];
  const state = flags(progress, day);
  const { card, order } = shown;
  const base = {
    schema: 1,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    day,
    generation,
    cardId: card.id,
    cardCategory: card.category,
    cardLevel: card.level,
    kind: state.fresh ? "new" : "review",
  } as const;
  const rows: VocabCandidate[] = [];
  const ranked = `${recallKey(recallOf(progress, day))}#${order}`;
  for (const category of [null, card.category]) {
    if (state.due)
      rows.push({ ...base, mode: "due", category, level: null, order: ranked });
    if (state.weak)
      rows.push({ ...base, mode: "weak", category, level: null, order: ranked });
    if (state.fresh && isWeak(progress))
      rows.push({ ...base, mode: "freshWeak", category, level: null, order });
  }
  if (state.fresh && !isWeak(progress)) {
    for (const mode of ["fresh", "freshLower"] as const)
      rows.push({
        ...base,
        mode,
        category: card.category,
        level: null,
        order: `${vocabLevelOrder(card.level, mode === "freshLower")}#${order}`,
      });
  }
  return rows;
}
