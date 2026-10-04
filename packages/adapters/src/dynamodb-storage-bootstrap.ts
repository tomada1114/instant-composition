import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ReadModelBootstrapStorage } from "@instant-composition/application";
import { decodeReadModelBootstrapState } from "./storage-bootstrap-schema";
import { dynamoSystemRecord } from "./dynamodb-system";

export function createDynamoDbReadModelBootstrapStorage(options: {
  readonly client: DynamoDBClient;
  readonly tableName: string;
}): ReadModelBootstrapStorage {
  return dynamoSystemRecord(
    DynamoDBDocumentClient.from(options.client),
    options.tableName,
    "readModelBootstrap",
    { PK: "SYSTEM#READMODEL", SK: "BOOTSTRAP" },
    decodeReadModelBootstrapState,
  );
}
