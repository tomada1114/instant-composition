import type {
  DayKey,
  ItemProgress,
  StreakRun,
  Weaknesses,
} from "@instant-composition/domain";
import type { HomePreview } from "./query-views";
import type { Stored } from "./store";

export interface CompositionSource {
  readonly schema: 1;
  readonly epoch: number;
}
export interface CompositionIdentity {
  readonly day: DayKey;
  readonly epoch: number;
  readonly catalogVersion: string;
  readonly settingsVersion: number | null;
  readonly statsVersion: number | null;
  readonly portionVersion: number | null;
  readonly tallyVersion: number | null;
}
export interface CompositionReadModel extends CompositionIdentity {
  readonly generation: string;
  readonly expiresAt?: number;
  readonly schema: 1;
  readonly available: number;
  readonly preview: HomePreview | null;
  readonly reach: Readonly<Record<string, number>>;
  readonly breakdown: Readonly<Record<string, number>>;
  readonly pending: number;
  readonly weak: Weaknesses;
}
export interface RankedCompositionCard {
  readonly id: string;
  readonly scheduled: boolean;
  readonly recall: number;
  readonly at: number;
}
export interface EvidenceCounts {
  readonly seen: number;
  readonly misses: number;
}
/** Membership is indexed by the immutable catalog order; no item schedules are retained. */
export interface CompositionBuild extends CompositionIdentity {
  readonly generation: string;
  readonly expiresAt?: number;
  readonly schema: 1;
  readonly phase: "items" | "ranks";
  readonly cursor: string | null;
  readonly known: string;
  readonly answered: number;
  readonly newAnswered: number;
  readonly due: number;
  readonly notDue: number;
  readonly notDueTop: readonly RankedCompositionCard[];
  readonly conceptFirst: Readonly<Record<string, RankedCompositionCard>>;
  readonly notDueConceptFirst: Readonly<Record<string, RankedCompositionCard>>;
  readonly notDueConceptRanks: Readonly<Record<string, number>>;
  readonly conceptRanks: Readonly<Record<string, number>>;
  readonly concepts: Readonly<Record<string, EvidenceCounts>>;
  readonly subtopics: Readonly<Record<string, EvidenceCounts>>;
  readonly reach: Readonly<Record<string, number>>;
  readonly breakdown: Readonly<Record<string, number>>;
  readonly pending: number;
}
export interface StreakMigration {
  readonly schema: 1;
  readonly statsVersion: number;
  readonly legacyCursor: number | null;
  readonly cursor: string | null;
  readonly open: StreakRun | null;
  readonly longest: number;
}
export interface StorePage<T> {
  readonly entries: readonly Stored<T>[];
  readonly cursor: string | null;
}
export interface PortionRange {
  readonly from: DayKey;
  readonly to: DayKey;
  readonly limit: number;
  readonly cursor?: string;
}
export interface ItemPageRequest {
  readonly limit: number;
  readonly cursor?: string;
}
export interface CompositionMaintenanceStep {
  readonly status: "ready" | "building" | "restarted";
  readonly rows: number;
  readonly day: DayKey;
}
export type CompositionItemPage = StorePage<ItemProgress>;

export function compositionSchemaSupported(value: {
  readonly schema: number;
}): boolean {
  return value.schema === 1;
}
