// The projection and independent maintenance surface, grouped by its owning context.
export type {
  StorageBootstrapRelease,
  ReadModelBootstrapState,
  ReadModelBootstrapStorage,
} from "./storage-bootstrap";
export {
  advanceReadModelBootstrap,
  type ReadModelBootstrapDriver,
  type ReadModelBootstrapResult,
} from "./read-model-bootstrap";
export { vocabReadModelsReady } from "./read-model-bootstrap-ready";
export {
  compositionSchemaSupported,
  type CompositionBuild,
  type CompositionReadModel,
  type CompositionSource,
  type CompositionMaintenanceStep,
  type ItemPageRequest,
  type PortionRange,
  type StorePage,
  type StreakMigration,
} from "./composition-model";
export { rebuildCompositionReadModel } from "./composition-maintenance";
export {
  compositionReadModelsReady,
  compositionReadModelsValidity,
} from "./composition-ready";
export {
  compositionCandidateId,
  type CompositionCandidate,
  type CompositionCandidateRequest,
} from "./composition-candidate";
export {
  READ_MODEL_PAGE_SIZE,
  CANDIDATE_PAGE_SIZE,
  vocabCandidateId,
} from "./read-model";
export type {
  CandidateMode,
  CandidatePage,
  CandidatePageRequest,
  PersonalCardPage,
  ReadModelSource,
  ReadModelStep,
  VocabCandidate,
  VocabCounts,
  VocabReadModel,
  VocabReadModelRequest,
  VocabReadModelRequestPage,
} from "./read-model";
export { rebuildVocabReadModel } from "./rebuild-read-model";
export { advanceReadModelMaintenance } from "./read-model-maintenance";
export type {
  MaintenanceCheckpoint,
  MaintenanceLearner,
  MaintenanceResult,
  ReadModelMaintenance,
} from "./read-model-maintenance";
export { advanceStoredReadModelBootstrap } from "./stored-read-model-bootstrap";
