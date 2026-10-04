import { randomUUID } from "node:crypto";

import {
  createDynamoDbDirectory,
  createDynamoDbReadModelMaintenance,
  backfillReadModelLearners,
  createDynamoDbStores,
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
} from "@instant-composition/adapters";
import type {
  LearnerDirectory,
  LearnerStores,
  ReadModelMaintenance,
} from "@instant-composition/application";

// DynamoDB local for the `dynamodb` vitest project, where `pnpm db:up` and
// ci.yml's service container both publish it. Nothing here asks for more than
// what it creates: each table is named for this run alone and deleted by
// `close`.

export const DYNAMODB_LOCAL_ENDPOINT = "http://localhost:8000";

export interface LocalTables {
  /** Stores on a fresh, empty table of their own. */
  fresh(): Promise<LearnerStores>;
  /** A directory and the stores beside it, on a fresh, empty table of their own. */
  freshBacking(): Promise<{ directory: LearnerDirectory; stores: LearnerStores }>;
  /** Fails with what to run when DynamoDB local is not answering. */
  reachable(): Promise<void>;
  freshMaintenance(): Promise<{
    stores: LearnerStores;
    directory: LearnerDirectory;
    maintenance: ReadModelMaintenance;
    backfill: (
      cursor: string | null,
    ) => Promise<{ cursor: string | null; rows: number }>;
  }>;
  close(): Promise<void>;
}

export function localTables(): LocalTables {
  const client = localDynamoDbClient(DYNAMODB_LOCAL_ENDPOINT);
  const created: string[] = [];

  async function create(): Promise<string> {
    // DynamoDB local's table names are case-insensitive, so the name is lower case.
    const tableName = `learners-${randomUUID()}`;
    await createLearnerTable(client, tableName);
    created.push(tableName);
    return tableName;
  }

  return {
    async fresh() {
      return createDynamoDbStores({ client, tableName: await create() });
    },
    async freshBacking() {
      const table = { client, tableName: await create() };
      return {
        directory: createDynamoDbDirectory(table),
        stores: createDynamoDbStores(table),
      };
    },
    async freshMaintenance() {
      const table = { client, tableName: await create() };
      return {
        stores: createDynamoDbStores(table),
        directory: createDynamoDbDirectory(table),
        maintenance: createDynamoDbReadModelMaintenance(table),
        backfill: (cursor) => backfillReadModelLearners(table, cursor),
      };
    },
    async reachable() {
      // No wait and no retry: `pnpm db:up` and ci.yml's service both return
      // only once the container's health check passes.
      try {
        await create();
      } catch (error) {
        throw new Error(
          `DynamoDB local is not answering on ${DYNAMODB_LOCAL_ENDPOINT}. Start it with \`pnpm db:up\`, then rerun \`pnpm test:dynamodb\`.`,
          { cause: error },
        );
      }
    },
    async close() {
      await Promise.all(
        created.splice(0).map((name) => deleteLearnerTable(client, name)),
      );
      client.destroy();
    },
  };
}
