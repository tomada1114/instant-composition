import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { roundSummarySchema } from "@instant-composition/contracts";

import { batchFor, makeApi, startedPlacement } from "./api-harness";
import { localTables } from "./dynamodb-local";

// The API over the DynamoDB store on DynamoDB local: the round's whole life
// through HTTP, as `pnpm api` serves it. Needs `pnpm db:up`; `pnpm
// test:dynamodb` runs it, never the default suite.

const tables = localTables();

beforeAll(async () => {
  await tables.reachable();
});

afterAll(async () => {
  await tables.close();
});

describe("the API on DynamoDB local", () => {
  it("starts, records, finishes and reads back a round", async () => {
    const api = makeApi({ stores: await tables.fresh() });
    const round = await startedPlacement(api);
    const batch = batchFor(round);

    expect((await api.call("POST", "/v1/rounds/p1/answers", batch)).status).toBe(204);
    expect((await api.call("POST", "/v1/rounds/p1/answers", batch)).status).toBe(204);
    const finished = await api.call("POST", "/v1/rounds/p1/finish", { answers: [] });
    const summary = roundSummarySchema.parse(await finished.json());
    const read = await api.call("GET", "/v1/rounds/p1/summary");

    expect(summary.roundId).toBe("p1");
    expect(roundSummarySchema.parse(await read.json())).toStrictEqual(summary);
    expect(api.lines.map((line) => line.outcome)).toStrictEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
  });
});
