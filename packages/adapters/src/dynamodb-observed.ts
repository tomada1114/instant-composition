import { GetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  observeStorageRow,
  type StoragePrimaryKey,
  type ObservedStorage,
} from "./storage-observed";
import type { StorageFamily } from "./storage-schema";

export async function observeDynamoStorage(
  documents: DynamoDBDocumentClient,
  table: string,
  type: StorageFamily,
  key: StoragePrimaryKey,
): Promise<ObservedStorage | undefined> {
  const result = await documents.send(
    new GetCommand({ TableName: table, Key: { ...key }, ConsistentRead: true }),
  );
  return observeStorageRow(type, key, result.Item);
}
