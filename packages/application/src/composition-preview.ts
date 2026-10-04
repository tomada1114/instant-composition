import {
  estimateMinutes,
  limitSecondsOf,
  TUNING,
  type LearnerStats,
  type Settings,
} from "@instant-composition/domain";
import { conceptName, subtopicName, type CatalogSnapshot } from "./catalog";
import type { CompositionBuild, CompositionReadModel } from "./composition-model";
import { compositionQueue } from "./composition-queue";

export function publishComposition(
  build: CompositionBuild,
  snapshot: CatalogSnapshot,
  settings: Settings | undefined,
  stats: LearnerStats,
  portionTarget: number | undefined,
  roundsStarted: number,
): CompositionReadModel {
  const {
    weak,
    weakConcepts,
    wantedNew,
    reviewCount,
    queued,
    size,
    available,
    newPrefix,
    reviewsInDeck,
    topUpCount,
    freshConcepts,
  } = compositionQueue(build, snapshot, settings, stats, portionTarget, roundsStarted);
  const dealtWeak = weakConcepts.filter(
    (concept) =>
      (build.conceptFirst[concept] !== undefined &&
        (build.conceptRanks[concept] ?? 0) < reviewsInDeck) ||
      freshConcepts.has(concept) ||
      (build.notDueConceptFirst[concept] !== undefined &&
        (build.notDueConceptRanks[concept] ?? 0) < topUpCount),
  );
  return {
    generation: build.generation,
    ...(build.expiresAt === undefined ? {} : { expiresAt: build.expiresAt }),
    schema: 1,
    day: build.day,
    epoch: build.epoch,
    catalogVersion: build.catalogVersion,
    settingsVersion: build.settingsVersion,
    statsVersion: build.statsVersion,
    portionVersion: build.portionVersion,
    tallyVersion: build.tallyVersion,
    available,
    reach: build.reach,
    breakdown: build.breakdown,
    pending: build.pending,
    weak,
    preview:
      Math.min(size, available) < Math.min(TUNING.minDeckSize, size)
        ? null
        : {
            size,
            setting: reviewCount + wantedNew,
            shortage: size < reviewCount + wantedNew,
            reviewCount:
              reviewsInDeck + Math.min(build.notDue, Math.max(0, size - queued)),
            newCount: newPrefix.length,
            focusNames: (settings?.focus ?? []).map((ref) =>
              subtopicName(snapshot, ref),
            ),
            weakNames: dealtWeak.map((concept) => conceptName(snapshot, concept)),
            minutes: estimateMinutes(size, limitSecondsOf(settings)),
          },
  };
}
