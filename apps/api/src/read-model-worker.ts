import {
  backfillReadModelLearners,
  createDynamoDbReadModelMaintenance,
  createDynamoDbReadModelBootstrapStorage,
  createDynamoDbStores,
  regionalDynamoDbClient,
  snapshotCatalog,
} from "@instant-composition/adapters";
import { type ApplicationDeps } from "@instant-composition/application";
import { readReadModelEnv } from "./env";
import { readModelBootstrapValidity } from "./read-model-runner";
import { createReadModelWorkerHandler } from "./read-model-dispatch";
export {
  READ_MODEL_WORKER_STEPS,
  runReadModelWorker,
  runReadModelBootstrap,
  runStoredReadModelBootstrap,
} from "./read-model-runner";

/** EventBridge and trusted deployment bootstrap share bounded, durable maintenance. */
export const handler = createReadModelWorkerHandler(() => {
  const env = readReadModelEnv();
  const client = regionalDynamoDbClient(env.region);
  const table = { client, tableName: env.tableName };
  const deps: ApplicationDeps = {
    stores: createDynamoDbStores(table),
    catalog: snapshotCatalog(env.catalogPath),
  };
  return {
    deps,
    maintenance: createDynamoDbReadModelMaintenance(table),
    storage: createDynamoDbReadModelBootstrapStorage(table),
    backfill: (cursor: string | null) => backfillReadModelLearners(table, cursor),
    now: Date.now(),
    ready: (context) => readModelBootstrapValidity(deps, context),
    close: () => {
      client.destroy();
    },
  };
});
