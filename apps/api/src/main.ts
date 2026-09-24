// The local run of the API (`pnpm api`): the app on Node, against DynamoDB
// local and the catalog snapshot, as the one stand-in learner. It listens on
// the loopback interface only and `readApiEnv` refuses to start inside AWS,
// because the stand-in authenticator lets every request in. Kept thin: what
// it wires is tested where it is defined.
import path from "node:path";

import { serve } from "@hono/node-server";
import {
  createDynamoDbStores,
  createLearnerTable,
  localDynamoDbClient,
  snapshotCatalog,
} from "@instant-composition/adapters";

import { API_ROOT, createApp } from "./app";
import { readApiEnv } from "./env";
import { localAuthenticator } from "./local-authenticator";
import { ensureTable } from "./local-table";
import { jsonLines } from "./log";

const LOOPBACK = "127.0.0.1";

const env = readApiEnv();
const write = (text: string): void => {
  process.stdout.write(text);
};
const client = localDynamoDbClient(env.dynamoDbEndpoint);
const created = await ensureTable(() => createLearnerTable(client, env.tableName));
const catalog = snapshotCatalog(path.resolve(env.catalogPath));
const app = createApp({
  stores: createDynamoDbStores({ client, tableName: env.tableName }),
  catalog,
  authenticator: localAuthenticator({
    id: env.learnerId,
    timeZone: env.learnerTimeZone,
  }),
  now: Date.now,
  requestId: () => crypto.randomUUID(),
  log: jsonLines(write),
});
const readable = (await catalog.snapshot()).ok;

serve({ fetch: app.fetch, port: env.port, hostname: LOOPBACK }, (info) => {
  write(
    `${JSON.stringify({
      event: "listening",
      url: `http://${LOOPBACK}:${String(info.port)}${API_ROOT}`,
      table: { name: env.tableName, created },
      // `false` until `pnpm catalog:build` has written the snapshot; the
      // catalog is read again on the next request that needs it.
      catalog: { path: env.catalogPath, readable },
    })}\n`,
  );
});
