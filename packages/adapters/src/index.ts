// The adapters behind packages/application's ports: the stores, the learner
// directory, the catalog and the language model.
export {
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
} from "./dynamodb-local";
export { regionalDynamoDbClient } from "./dynamodb-client";
export { createDynamoDbDirectory } from "./dynamodb-directory";
export { createDynamoDbStores, type DynamoDbStoresOptions } from "./dynamodb-store";
export { MAX_COMMIT_ITEMS } from "./keys";
export { createMemoryDirectory } from "./memory-directory";
export { createMemoryStores, type MemoryStores } from "./memory-store";
export {
  createOpenRouterModel,
  type Fetch,
  type OpenRouterOptions,
} from "./openrouter-model";
export { snapshotCatalog } from "./snapshot-catalog";
export {
  createStandInModel,
  type StandInModel,
  type StandInScript,
} from "./stand-in-model";

export {
  decodeStorageRecord,
  STORAGE_FAMILIES,
  decodeStorageRow,
  encodeStorageValue,
  StorageSchemaError,
  STORAGE_SCHEMA_VERSION,
  type DecodedStorage,
  type StorageFamily,
} from "./storage-schema";

export { executeStorageMaintenance } from "./storage-maintenance";
export { createDynamoDbReadModelBootstrapStorage } from "./dynamodb-storage-bootstrap";
export { decodeReadModelBootstrapState } from "./storage-bootstrap-schema";
export { createDynamoDbReadModelMaintenance } from "./dynamodb-read-model-maintenance";

export { backfillReadModelLearners } from "./read-model-backfill";
