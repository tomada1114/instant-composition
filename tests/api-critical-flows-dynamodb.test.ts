import { afterAll, beforeAll } from "vitest";
import { describeCriticalFlows } from "./critical-flow-contract";
import { localTables } from "./dynamodb-local";
const tables = localTables();
beforeAll(() => tables.reachable());
afterAll(() => tables.close());
describeCriticalFlows("client critical flows over actual DynamoDB local", () =>
  tables.freshBacking(),
);
