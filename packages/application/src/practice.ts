import {
  EMPTY_STATS,
  ok,
  practiceState,
  type ItemProgress,
  type LearnerStats,
  type PracticeState,
  type Result,
  type Settings,
} from "@instant-composition/domain";

import type { Catalog, CatalogSnapshot } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { todayOf } from "./execute";
import type { LearnerStore, Stored } from "./store";

/** What most commands and queries read first, taken once per attempt. */
export interface PracticeLoad {
  readonly snapshot: CatalogSnapshot;
  readonly settings: Stored<Settings> | undefined;
  readonly stats: Stored<LearnerStats> | undefined;
  readonly items: ReadonlyMap<string, Stored<ItemProgress>>;
  readonly practice: PracticeState;
}

/** The learner's totals, or empty ones before the first write. */
export function statsOf(load: {
  readonly stats: Stored<LearnerStats> | undefined;
}): LearnerStats {
  return load.stats?.value ?? EMPTY_STATS;
}

export function itemValues(
  items: ReadonlyMap<string, Stored<ItemProgress>>,
): Map<string, ItemProgress> {
  return new Map([...items].map(([id, stored]) => [id, stored.value]));
}

/**
 * The catalog, the settings, the totals and every item's progress, and the
 * dealing state they make for today. `settings` stands in for the stored ones
 * when a command is about to replace them.
 */
export async function loadPractice(
  store: LearnerStore,
  catalog: Catalog,
  context: RequestContext,
  settings?: Settings,
): Promise<Result<PracticeLoad, ApplicationError>> {
  const snapshot = await catalog.snapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  const [stored, stats, items] = await Promise.all([
    store.settings(),
    store.stats(),
    store.items(),
  ]);
  return ok({
    snapshot: snapshot.value,
    settings: stored,
    stats,
    items,
    practice: practiceState({
      today: todayOf(context),
      stats: stats?.value ?? EMPTY_STATS,
      settings: settings ?? stored?.value,
      cards: [...snapshot.value.shown.values()],
      items: itemValues(items),
    }),
  });
}
