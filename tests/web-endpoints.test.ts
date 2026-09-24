import { describe, expect, it, vi } from "vitest";

import {
  API_ROOT,
  finishRound,
  getHome,
  getRecords,
  getRoundSummary,
  getSettings,
  operationUrl,
  recordAnswers,
  requestFinish,
  requestRound,
  roundKindFrom,
  sendAnswer,
  startRound,
  updateSettings,
  type AnswerInput,
} from "@instant-composition/web";

// The web client's calls against the contract, driven through a stubbed
// `fetch`: the path each one sends to under /api, the body, and how each kind
// of answer — the success schema, the error envelope, a body that is neither,
// no answer at all — comes back.

const ANSWER: AnswerInput = {
  id: "r:f:c1",
  roundId: "r",
  cardId: "c1",
  pass: "first",
  result: "ok",
  elapsedMs: 1200,
};

interface Call {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: unknown;
  readonly contentType: string | null;
}

function stubFetch(respond: () => Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      contentType: new Headers(init?.headers).get("content-type"),
    });
    return respond();
  });
  return calls;
}

function envelope(status: number, code: string): Response {
  return Response.json({ error: { code, message: "A fixed sentence." } }, { status });
}

describe("operationUrl", () => {
  it("puts the contract's path under the SPA's own /api", () => {
    expect(API_ROOT).toBe("/api");
    expect(operationUrl({ url: "/v1/home" })).toBe("/api/v1/home");
  });

  it("fills a path parameter, encoded", () => {
    expect(
      operationUrl({
        url: "/v1/rounds/{roundId}/answers",
        path: { roundId: "a b/c" },
      }),
    ).toBe("/api/v1/rounds/a%20b%2Fc/answers");
  });

  it("leaves a parameter nothing fills empty rather than sending its name", () => {
    expect(operationUrl({ url: "/v1/rounds/{roundId}/summary" })).toBe(
      "/api/v1/rounds//summary",
    );
  });
});

describe("getHome", () => {
  it("gets /api/v1/home with no body and answers the view", async () => {
    const calls = stubFetch(() => Promise.resolve(Response.json({ sound: true })));
    expect(await getHome()).toStrictEqual({ ok: true, value: { sound: true } });
    expect(calls).toStrictEqual([
      { url: "/api/v1/home", method: "GET", body: undefined, contentType: null },
    ]);
  });

  it("passes on the envelope's code", async () => {
    stubFetch(() => Promise.resolve(envelope(403, "ERR_FORBIDDEN")));
    expect(await getHome()).toStrictEqual({
      ok: false,
      error: { code: "ERR_FORBIDDEN" },
    });
  });

  it.each([
    ["a body that is not JSON", () => new Response("oops", { status: 500 })],
    [
      "JSON that is not the envelope",
      () => Response.json({ oops: 1 }, { status: 500 }),
    ],
    ["an envelope with no code", () => Response.json({ error: {} }, { status: 500 })],
    [
      "an envelope whose error is a string",
      () => Response.json({ error: "no" }, { status: 500 }),
    ],
    ["a null body", () => Response.json(null, { status: 502 })],
  ])("calls %s a network error", async (_, response) => {
    stubFetch(() => Promise.resolve(response()));
    expect(await getHome()).toStrictEqual({
      ok: false,
      error: { code: "ERR_NETWORK" },
    });
  });

  it("calls an unreachable server a network error", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await getHome()).toStrictEqual({
      ok: false,
      error: { code: "ERR_NETWORK" },
    });
  });
});

describe("the reads each screen makes", () => {
  it.each([
    ["getSettings", getSettings, "/api/v1/settings"],
    ["getRecords", getRecords, "/api/v1/records"],
    [
      "getRoundSummary",
      () => getRoundSummary("round 1"),
      "/api/v1/rounds/round%201/summary",
    ],
  ] as const)("%s gets %s with no body and answers its view", async (_, read, url) => {
    const calls = stubFetch(() => Promise.resolve(Response.json({ read: true })));
    expect(await read()).toStrictEqual({ ok: true, value: { read: true } });
    expect(calls).toStrictEqual([
      { url, method: "GET", body: undefined, contentType: null },
    ]);
  });

  it("passes on the round a summary read cannot find", async () => {
    stubFetch(() => Promise.resolve(envelope(404, "ERR_ROUND_NOT_FOUND")));
    expect(await getRoundSummary("r")).toStrictEqual({
      ok: false,
      error: { code: "ERR_ROUND_NOT_FOUND" },
    });
  });
});

describe("updateSettings", () => {
  it("patches /api/v1/settings with the fields to change, as JSON", async () => {
    const calls = stubFetch(() =>
      Promise.resolve(Response.json({ settings: { sound: false } })),
    );
    expect(await updateSettings({ sound: false })).toStrictEqual({
      ok: true,
      value: { settings: { sound: false } },
    });
    expect(calls).toStrictEqual([
      {
        url: "/api/v1/settings",
        method: "PATCH",
        body: { sound: false },
        contentType: "application/json",
      },
    ]);
  });
});

describe("startRound and requestRound", () => {
  it("posts the client's round id and the kind", async () => {
    const calls = stubFetch(() => Promise.resolve(Response.json({ id: "r1" })));
    expect(await startRound({ roundId: "r1", kind: "extra" })).toStrictEqual({
      ok: true,
      value: { id: "r1" },
    });
    expect(calls[0]).toMatchObject({
      url: "/api/v1/rounds",
      method: "POST",
      body: { roundId: "r1", kind: "extra" },
    });
  });

  it("makes a fresh id for each ask unless one is given", async () => {
    const calls = stubFetch(() => Promise.resolve(Response.json({ id: "r" })));
    await requestRound("today");
    await requestRound("today");
    await requestRound("placement", "given");
    const ids = calls.map((call) => (call.body as { roundId: string }).roundId);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toMatch(/^[\w-]{1,64}$/u);
    expect(calls[2]?.body).toStrictEqual({ roundId: "given", kind: "placement" });
  });

  it("passes on a refusal such as too few cards", async () => {
    stubFetch(() => Promise.resolve(envelope(409, "ERR_NOT_ENOUGH_CARDS")));
    expect(await requestRound("today")).toStrictEqual({
      ok: false,
      error: { code: "ERR_NOT_ENOUGH_CARDS" },
    });
  });
});

describe("finishRound and requestFinish", () => {
  it("posts the batch under the round's path, without the round in each answer", async () => {
    const calls = stubFetch(() => Promise.resolve(Response.json({ roundId: "r" })));
    expect(await requestFinish("r", [ANSWER])).toStrictEqual({
      ok: true,
      value: { roundId: "r" },
    });
    expect(calls[0]).toMatchObject({
      url: "/api/v1/rounds/r/finish",
      method: "POST",
      body: {
        answers: [
          { id: "r:f:c1", cardId: "c1", pass: "first", result: "ok", elapsedMs: 1200 },
        ],
      },
    });
  });

  it("sends an empty batch for a round with nothing left to add", async () => {
    const calls = stubFetch(() => Promise.resolve(Response.json({ roundId: "r" })));
    await finishRound("r", []);
    expect(calls[0]?.body).toStrictEqual({ answers: [] });
  });
});

describe("recordAnswers and sendAnswer", () => {
  it("posts one answer as a batch of one under its round", async () => {
    const calls = stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await sendAnswer(ANSWER)).toBe("sent");
    expect(calls[0]).toMatchObject({
      url: "/api/v1/rounds/r/answers",
      method: "POST",
      body: {
        answers: [
          { id: "r:f:c1", cardId: "c1", pass: "first", result: "ok", elapsedMs: 1200 },
        ],
      },
    });
  });

  it.each([
    ["a 204", () => new Response(null, { status: 204 }), "sent"],
    ["a bad request", () => envelope(400, "ERR_BAD_REQUEST"), "rejected"],
    ["a round not found", () => envelope(404, "ERR_ROUND_NOT_FOUND"), "rejected"],
    ["a closed round", () => envelope(409, "ERR_ROUND_CLOSED"), "rejected"],
    [
      "a conflict, which may be sent again",
      () => envelope(409, "ERR_CONFLICT"),
      "failed",
    ],
    [
      "a 4xx with no readable body",
      () => new Response("", { status: 404 }),
      "rejected",
    ],
    ["a 500", () => new Response(null, { status: 500 }), "failed"],
    ["a 503", () => envelope(503, "ERR_CONTENT_UNREADABLE"), "failed"],
  ] as const)("reads %s as %s", async (_, response, outcome) => {
    stubFetch(() => Promise.resolve(response()));
    expect(await recordAnswers("r", [])).toBe(outcome);
  });

  it("reads an unreachable server as failed", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await sendAnswer(ANSWER)).toBe("failed");
  });
});

describe("roundKindFrom", () => {
  it.each([
    ["placement", "placement"],
    ["yesterday", "yesterday"],
    ["extra", "extra"],
    ["today", "today"],
    [undefined, "today"],
    ["bonus", "today"],
    [3, "today"],
  ] as const)("reads %j as %s", (value, kind) => {
    expect(roundKindFrom(value)).toBe(kind);
  });
});
