// The adapters behind packages/application's ports: the stores, the learner
// directory and the catalog.
export {
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
} from "./dynamodb-local";
export { createDynamoDbDirectory } from "./dynamodb-directory";
export { createDynamoDbStores, type DynamoDbStoresOptions } from "./dynamodb-store";
export { MAX_COMMIT_ITEMS } from "./keys";
export { createMemoryDirectory } from "./memory-directory";
export { createMemoryStores, type MemoryStores } from "./memory-store";
export { snapshotCatalog } from "./snapshot-catalog";
