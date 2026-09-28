import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

/**
 * A client for DynamoDB in `region`, over its public endpoint (ADR-0009: no
 * VPC), signed with whatever credentials the SDK's default chain finds — on
 * Lambda, the function's execution role. The composition root of a hosted
 * entry builds it; the stores and the directory never build their own.
 */
export function regionalDynamoDbClient(region: string): DynamoDBClient {
  return new DynamoDBClient({ region });
}
