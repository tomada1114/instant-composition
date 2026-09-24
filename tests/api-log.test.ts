import { describe, expect, it } from "vitest";

import { jsonLines, type LogLine } from "@instant-composition/api";
import type { Catalog } from "@instant-composition/application";

import { batchFor, makeApi, startedPlacement } from "./api-harness";
import { makeSnapshot } from "./application-harness";

// One JSON line per request: the request id, the contract operation, how it
// ended, the status and how long it took — and nothing the caller sent.

describe("the request log", () => {
  it("writes one line per request, answered or refused", async () => {
    const api = makeApi();
    await api.call("GET", "/v1/home");
    await api.call("GET", "/v1/rounds/p9/summary");

    expect(api.lines).toStrictEqual<LogLine[]>([
      {
        requestId: "req-1",
        operation: "getHome",
        outcome: "ok",
        status: 200,
        durationMs: 0,
        learnerId: "local-learner",
        fault: null,
      },
      {
        requestId: "req-2",
        operation: "getRoundSummary",
        outcome: "ERR_ROUND_NOT_FOUND",
        status: 404,
        durationMs: 0,
        learnerId: "local-learner",
        fault: null,
      },
    ]);
  });

  it("measures the whole request, including the work behind it", async () => {
    const snapshot = makeSnapshot();
    const holder: { advance?: (ms: number) => void } = {};
    const slow: Catalog = {
      snapshot: () => {
        holder.advance?.(250);
        return Promise.resolve({ ok: true, value: snapshot });
      },
    };
    const api = makeApi({ catalog: slow });
    holder.advance = api.advance;
    await api.call("GET", "/v1/home");
    expect(api.lines.map((line) => line.durationMs)).toStrictEqual([250]);
  });

  it("logs a request no contract operation matches as unmatched, with no learner", async () => {
    const api = makeApi();
    const response = await api.call("DELETE", "/v1/settings");
    expect(response.status).toBe(404);
    expect(api.lines).toMatchObject([
      { operation: null, outcome: "unmatched", status: 404, learnerId: null },
    ]);
  });

  it("answers a bare 500 when a handler throws, and logs the error's class alone", async () => {
    const api = makeApi({
      authenticator: {
        authenticate: () =>
          Promise.reject(new RangeError("a detail only the server holds")),
      },
    });
    const response = await api.call("GET", "/v1/settings");

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(api.lines).toStrictEqual<LogLine[]>([
      {
        requestId: "req-1",
        operation: "getSettings",
        outcome: "failed",
        status: 500,
        durationMs: 0,
        learnerId: null,
        fault: "RangeError",
      },
    ]);
  });

  it("carries no body, card text or answer of the request it records", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    await api.call("POST", "/v1/rounds/p1/finish", batchFor(round, "ng"));
    const written = JSON.stringify(api.lines);
    const card = makeSnapshot().shown.get(round.deck[0] ?? "");

    expect(api.lines.map((line) => line.operation)).toStrictEqual([
      "updateSettings",
      "startRound",
      "finishRound",
    ]);
    expect(written).not.toContain(round.deck[0]);
    expect(written).not.toContain(card?.prompt);
    expect(written).not.toContain('"ng"');
    expect(written).not.toContain("travel");
  });

  it("writes each line as one line of JSON", () => {
    const written: string[] = [];
    const line: LogLine = {
      requestId: "req-1",
      operation: "getHome",
      outcome: "ok",
      status: 200,
      durationMs: 12,
      learnerId: "local-learner",
      fault: null,
    };
    jsonLines((text) => written.push(text))(line);
    expect(written).toStrictEqual([
      '{"requestId":"req-1","operation":"getHome","outcome":"ok","status":200,"durationMs":12,"learnerId":"local-learner","fault":null}\n',
    ]);
  });
});
