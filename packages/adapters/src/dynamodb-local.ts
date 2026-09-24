import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";

import { LEARNER_TABLE_KEY } from "./keys";

// DynamoDB local, for tests and for running the API on a checkout. In AWS the
// learner table belongs to the stateful stack and the client to the API's
// composition root; nothing here is meant for them.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A client for DynamoDB local at `endpoint`. The endpoint, region and
 * credentials are all stated, so nothing is read from the process's AWS
 * settings and no request can fall through to a real account.
 *
 * @throws RangeError when `endpoint` is not an http(s) URL on a loopback host.
 */
export function localDynamoDbClient(endpoint: string): DynamoDBClient {
  const url = URL.parse(endpoint);
  if (url === null || !/^https?:$/.test(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw new RangeError("DynamoDB local is reached on a loopback address only.");
  }
  return new DynamoDBClient({
    endpoint: url.origin,
    region: "local",
    // DynamoDB local takes any access key made of letters and digits alone.
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
}

/** Creates an on-demand learner table keyed the way the store reads it. */
export async function createLearnerTable(
  client: DynamoDBClient,
  tableName: string,
): Promise<void> {
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: LEARNER_TABLE_KEY.partition, AttributeType: "S" },
        { AttributeName: LEARNER_TABLE_KEY.sort, AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: LEARNER_TABLE_KEY.partition, KeyType: "HASH" },
        { AttributeName: LEARNER_TABLE_KEY.sort, KeyType: "RANGE" },
      ],
    }),
  );
}

export async function deleteLearnerTable(
  client: DynamoDBClient,
  tableName: string,
): Promise<void> {
  await client.send(new DeleteTableCommand({ TableName: tableName }));
}
