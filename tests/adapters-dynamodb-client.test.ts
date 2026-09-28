import { describe, expect, it } from "vitest";

import { regionalDynamoDbClient } from "@instant-composition/adapters";

// The client a hosted entry builds: DynamoDB in the Region it names, on the
// service's own endpoint. Nothing is sent, so no AWS call is made.

describe("regionalDynamoDbClient", () => {
  it("addresses DynamoDB in the Region it is given, on no custom endpoint", async () => {
    const client = regionalDynamoDbClient("ap-northeast-1");

    expect(await client.config.region()).toBe("ap-northeast-1");
    expect(client.config.endpoint).toBeUndefined();
    client.destroy();
  });
});
