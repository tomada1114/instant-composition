import type { LearnerStats, Settings } from "@instant-composition/domain";
import type { CatalogSnapshot } from "./catalog";
import type { CompositionBuild, RankedCompositionCard } from "./composition-model";
import type { CompositionCandidate } from "./composition-candidate";
import { compositionQueue } from "./composition-queue";
import type { LearnerStore } from "./store";

/** Fixed finite quotas read only their head plus changed ids. Explicit unlimited decks may traverse pages. */
export async function compositionHeads(
  store: LearnerStore,
  build: CompositionBuild,
  snapshot: CatalogSnapshot,
  settings: Settings | undefined,
  stats: LearnerStats,
  portionTarget: number | undefined,
  roundsStarted: number,
  changed: ReadonlySet<string>,
  replacements: readonly CompositionCandidate[],
): Promise<CompositionBuild> {
  const queue = compositionQueue(
    build,
    snapshot,
    settings,
    stats,
    portionTarget,
    roundsStarted,
  );
  async function head(
    mode: CompositionCandidate["mode"],
    wanted: number,
  ): Promise<CompositionCandidate[]> {
    if (wanted === 0) return [];
    const rows: CompositionCandidate[] = [];
    let cursor: string | null = null;
    do {
      const page = await store.compositionCandidates({
        day: build.day,
        generation: build.generation,
        mode,
        limit: Math.min(250, Math.max(1, wanted + changed.size - rows.length)),
        cursor,
      });
      rows.push(...page.rows.map(({ value }) => value));
      cursor = page.cursor;
    } while (cursor !== null && rows.length < wanted + changed.size);
    return [
      ...rows.filter((row) => !changed.has(row.id)),
      ...replacements.filter((row) => row.mode === mode),
    ]
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      .slice(0, wanted);
  }
  const [due, notDue] = await Promise.all([
    head("due", queue.reviewsInDeck),
    head("notDue", queue.topUpCount),
  ]);
  const ranked = (row: CompositionCandidate): RankedCompositionCard => ({
    id: row.id,
    scheduled: row.scheduled,
    recall: row.recall,
    at: row.at,
  });
  const first: Record<string, RankedCompositionCard> = {};
  const notDueFirst: Record<string, RankedCompositionCard> = {};
  const ranks: Record<string, number> = {};
  const notDueRanks: Record<string, number> = {};
  for (const [rows, kept, positions] of [
    [due, first, ranks],
    [notDue, notDueFirst, notDueRanks],
  ] as const)
    rows.forEach((row, index) => {
      for (const concept of snapshot.shown.get(row.id)?.concepts ?? [])
        if (queue.weakConcepts.includes(concept) && kept[concept] === undefined) {
          kept[concept] = ranked(row);
          positions[concept] = index;
        }
    });
  return {
    ...build,
    conceptFirst: first,
    conceptRanks: ranks,
    notDueConceptFirst: notDueFirst,
    notDueConceptRanks: notDueRanks,
    notDueTop: notDue.slice(0, 5).map(ranked),
  };
}
