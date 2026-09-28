// The local run of the API (`pnpm api`): the app on Node, against DynamoDB
// local and the catalog snapshot. It verifies Cognito access tokens when
// `API_COGNITO_*` name a user pool, and otherwise serves the one stand-in
// subject. Either way it listens on the loopback interface only and
// `readApiEnv` refuses to start inside AWS, because the stand-in lets every
// request in. Kept thin: what it wires is tested where it is defined.
import path from "node:path";

import { serve } from "@hono/node-server";
import {
  createDynamoDbDirectory,
  createDynamoDbStores,
  createLearnerTable,
  localDynamoDbClient,
  snapshotCatalog,
} from "@instant-composition/adapters";
import { learnerId } from "@instant-composition/application";

import { API_ROOT, createApp } from "./app";
import { readApiEnv } from "./env";
import { localRunAuthenticator } from "./local-run-authenticator";
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
const table = { client, tableName: env.tableName };
const { kind, authenticator } = localRunAuthenticator(env.cognito);
const app = createApp({
  stores: createDynamoDbStores(table),
  catalog,
  directory: createDynamoDbDirectory(table),
  newLearnerId: () => learnerId(crypto.randomUUID()),
  authenticator,
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
      authenticator: kind,
      table: { name: env.tableName, created },
      // `false` until `pnpm catalog:build` has written the snapshot; the
      // catalog is read again on the next request that needs it.
      catalog: { path: env.catalogPath, readable },
    })}\n`,
  );
});
