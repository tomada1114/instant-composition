import type { Entry } from "@instant-composition/application";

/** Storage declarations are independent of optimistic row versions. */
export const STORAGE_SCHEMA_VERSION = 5;
export type StorageFamily =
  | Entry["type"]
  | "identity"
  | "readModelLearner"
  | "readModelMaintenance"
  | "readModelBootstrap";
export const STORAGE_FAMILIES = [
  "identity",
  "profile",
  "settings",
  "stats",
  "round",
  "review",
  "portion",
  "day",
  "item",
  "talk",
  "vocabItem",
  "vocabSession",
  "vocabReview",
  "card",
  "modelTask",
  "readModelSource",
  "vocabReadModel",
  "vocabCandidate",
  "vocabReadModelRequest",
  "compositionSource",
  "compositionReadModel",
  "compositionBuild",
  "compositionCandidate",
  "streakRun",
  "streakMigration",
  "readModelLearner",
  "readModelMaintenance",
  "readModelBootstrap",
  "vocabPagedSession",
  "vocabDeckPage",
  "vocabPageProgress",
  "vocabSessionGuard",
] as const satisfies readonly StorageFamily[];
const PAGED = new Set<string>(STORAGE_FAMILIES.slice(28));
const ORIGINAL = new Set<string>(STORAGE_FAMILIES.slice(0, 14));
export function storageFamilyBirth(type: StorageFamily): number {
  return ORIGINAL.has(type) ? 0 : type === "modelTask" ? 3 : PAGED.has(type) ? 5 : 4;
}
