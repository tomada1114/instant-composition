// The adapters behind packages/application's ports: the stores and the catalog.
export {
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
} from "./dynamodb-local";
export { createDynamoDbStores, type DynamoDbStoresOptions } from "./dynamodb-store";
export { MAX_COMMIT_ITEMS } from "./keys";
export { createMemoryStores, type MemoryStores } from "./memory-store";
export { snapshotCatalog } from "./snapshot-catalog";
