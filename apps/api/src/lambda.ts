// The hosted entry: the app on Lambda behind API Gateway's HTTP API,
// against the learner table in the function's Region and the catalog snapshot
// bundled with it. `readHostedEnv` validates the environment once, here, when
// the function starts, and throws — failing the start — without the user pool
// and web client settings; the stand-in authenticator is never wired.
// Kept thin: what it wires is tested where it is defined.
import path from "node:path";

import {
  createDynamoDbDirectory,
  createDynamoDbStores,
  regionalDynamoDbClient,
  snapshotCatalog,
} from "@instant-composition/adapters";
import { learnerId } from "@instant-composition/application";

import { readHostedEnv } from "./env";
import { hostedHandler } from "./hosted";
import { jsonLines } from "./log";

const env = readHostedEnv();
const table = { client: regionalDynamoDbClient(env.region), tableName: env.tableName };

export const handler = hostedHandler(env, {
  stores: createDynamoDbStores(table),
  catalog: snapshotCatalog(path.resolve(env.catalogPath)),
  directory: createDynamoDbDirectory(table),
  newLearnerId: () => learnerId(crypto.randomUUID()),
  now: Date.now,
  requestId: () => crypto.randomUUID(),
  log: jsonLines((text) => {
    process.stdout.write(text);
  }),
  fetch: (request) => fetch(request),
});
