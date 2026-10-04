import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { type ReadModelMaintenance } from "@instant-composition/application";
import { dynamoSystemRecord } from "./dynamodb-system";
import { observeStorageRow } from "./storage-observed";

import { maintenanceCheckpointOf } from "./read-model-maintenance-schema";
import { maintenancePageKey } from "./read-model-maintenance-key";
import { READ_MODEL_REGISTRY, registryLearner } from "./read-model-registry";

const KEY = { PK: "SYSTEM#READMODEL", SK: "CHECKPOINT" } as const;

/** A separate system port; no learner-bound method can scan another partition. */
export function createDynamoDbReadModelMaintenance(options: {
  readonly client: DynamoDBClient;
  readonly tableName: string;
}): ReadModelMaintenance {
  const documents = DynamoDBDocumentClient.from(options.client);
  return {
    ...dynamoSystemRecord(
      documents,
      options.tableName,
      "readModelMaintenance",
      KEY,
      maintenanceCheckpointOf,
    ),
    async profiles(cursor) {
      const start = maintenancePageKey(cursor);
      if (start !== undefined && start.PK !== READ_MODEL_REGISTRY)
        throw new RangeError("A registry cursor names its own primary partition.");
      const result = await documents.send(
        new QueryCommand({
          TableName: options.tableName,
          ConsistentRead: true,
          Limit: 100,
          KeyConditionExpression: "#pk = :registry",
          ExpressionAttributeNames: { "#pk": "PK" },
          ExpressionAttributeValues: { ":registry": READ_MODEL_REGISTRY },
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      return {
        learners: (result.Items ?? []).map((row) => {
          const checked = observeStorageRow(
            "readModelLearner",
            { PK: READ_MODEL_REGISTRY, SK: String(row["SK"]) },
            row,
          );
          if (checked === undefined) throw new TypeError("A registry row is absent.");
          const learner = registryLearner(checked.value);
          return learner;
        }),
        cursor:
          result.LastEvaluatedKey === undefined
            ? null
            : JSON.stringify(result.LastEvaluatedKey),
      };
    },
  };
}
