import { QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ReviewPage } from "@instant-composition/application";

import { storedOf } from "./dynamodb-rows";
import { LEARNER_TABLE_KEY, reviewsPrefix } from "./keys";

export const REVIEW_PAGE_SIZE = 32;

/** The legacy initializer's bounded read; its cursor cannot escape the round's prefix. */
export async function dynamoReviewPage(
  documents: DynamoDBDocumentClient,
  table: string,
  partition: string,
  sessionId: string,
  cursor: string | null,
): Promise<ReviewPage> {
  const prefix = reviewsPrefix(sessionId);
  if (cursor !== null && !cursor.startsWith(prefix)) {
    throw new RangeError("A review cursor belongs to its round.");
  }
  const page = await documents.send(
    new QueryCommand({
      TableName: table,
      ConsistentRead: true,
      Limit: REVIEW_PAGE_SIZE,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: {
        "#pk": LEARNER_TABLE_KEY.partition,
        "#sk": LEARNER_TABLE_KEY.sort,
      },
      ExpressionAttributeValues: { ":pk": partition, ":prefix": prefix },
      ...(cursor === null
        ? {}
        : {
            ExclusiveStartKey: {
              [LEARNER_TABLE_KEY.partition]: partition,
              [LEARNER_TABLE_KEY.sort]: cursor,
            },
          }),
    }),
  );
  const next: unknown = page.LastEvaluatedKey?.[LEARNER_TABLE_KEY.sort];
  return {
    entries: (page.Items ?? []).map((row) => storedOf("review", row).value),
    cursor: typeof next === "string" ? next : null,
  };
}
