// The local run of the API (`pnpm api`): the app on Node, against DynamoDB
// local and the catalog snapshot. It verifies Cognito access tokens, and
// serves the web sign-in endpoints, when `API_COGNITO_*` name a user pool,
// and otherwise serves the one stand-in subject. Either way it listens on the
// loopback interface only and `readApiEnv` refuses to start inside AWS,
// because the stand-in lets every request in. Talks are served by OpenRouter
// when `API_OPENROUTER_API_KEY` is set — `pnpm api` lets Node read it from
// `.env.local` — and by the scripted stand-in model otherwise.
// Kept thin: what it wires is tested where it is defined.
import path from "node:path";

import { serve } from "@hono/node-server";
import {
  createDynamoDbDirectory,
  createDynamoDbReadModelMaintenance,
  createDynamoDbStores,
  createLearnerTable,
  localDynamoDbClient,
  snapshotCatalog,
} from "@instant-composition/adapters";
import { learnerId } from "@instant-composition/application";

import { API_ROOT, createApp } from "./app";
import { readApiEnv } from "./env";
import { localRunAuthenticator, localRunWebSession } from "./local-run-authenticator";
import { ensureTable } from "./local-table";
import { runReadModelWorker } from "./read-model-worker";
import { jsonLines } from "./log";
import { localModel } from "./served-model";

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
const model = localModel(env.model, (request) => fetch(request));
const stores = createDynamoDbStores(table);
const app = createApp({
  stores,
  catalog,
  directory: createDynamoDbDirectory(table),
  newLearnerId: () => learnerId(crypto.randomUUID()),
  authenticator,
  now: Date.now,
  requestId: () => crypto.randomUUID(),
  log: jsonLines(write),
  webSession: localRunWebSession(env.cognito, (request) => fetch(request)),
  model,
});
const readable = (await catalog.snapshot()).ok;
const maintenance = createDynamoDbReadModelMaintenance(table);
let preparing = false;
setInterval(() => {
  if (preparing) return;
  preparing = true;
  void runReadModelWorker({ stores, catalog }, maintenance, Date.now())
    .catch(() => {
      write(
        `${JSON.stringify({ event: "read-model-maintenance", outcome: "failed" })}\n`,
      );
    })
    .finally(() => {
      preparing = false;
    });
}, 1_000).unref();

serve({ fetch: app.fetch, port: env.port, hostname: LOOPBACK }, (info) => {
  write(
    `${JSON.stringify({
      event: "listening",
      url: `http://${LOOPBACK}:${String(info.port)}${API_ROOT}`,
      authenticator: kind,
      model: { provider: model.provider, modelId: model.modelId },
      table: { name: env.tableName, created },
      // `false` until `pnpm catalog:build` has written the snapshot; the
      // catalog is read again on the next request that needs it.
      catalog: { path: env.catalogPath, readable },
    })}\n`,
  );
});
