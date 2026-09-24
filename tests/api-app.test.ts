import { describe, expect, it } from "vitest";

import {
  localAuthenticator,
  MAX_REQUEST_BODY_BYTES,
  type Authenticator,
} from "@instant-composition/api";
import { learnerId } from "@instant-composition/application";
import {
  errorResponseSchema,
  MESSAGE_BY_CODE,
  ROUTES,
} from "@instant-composition/contracts";

import { batchFor, makeApi, startedPlacement, type ApiHarness } from "./api-harness";
import { unreadableCatalog } from "./application-harness";

// The app driven with `new Request(…)` over the in-memory store: each answer
// is checked against the contract's schema for it, and each refusal against
// the envelope and the status STATUS_BY_CODE gives its code.

/** The body `response` carries, checked against the contract's success schema for `operationId`. */
async function contracted(response: Response, operationId: string): Promise<unknown> {
  const entry = ROUTES.find((candidate) => candidate.operationId === operationId);
  expect(response.status).toBe(entry?.success.status);
  const body: unknown = await response.json();
  return entry?.success.body?.parse(body);
}

async function refusal(response: Response): Promise<[number, string]> {
  const body = errorResponseSchema.parse(await response.json());
  return [response.status, body.error.code];
}

async function finished(api: ApiHarness, roundId = "p1"): Promise<unknown> {
  const round = await startedPlacement(api, roundId);
  const response = await api.call(
    "POST",
    `/v1/rounds/${roundId}/finish`,
    batchFor(round),
  );
  return contracted(response, "finishRound");
}

describe("the queries", () => {
  it.each([
    ["getHome", "/v1/home"],
    ["getRecords", "/v1/records"],
    ["getSettings", "/v1/settings"],
    ["getHistory", "/v1/history"],
  ])("%s answers its view", async (operationId, path) => {
    const api = makeApi();
    await startedPlacement(api);
    const view = await contracted(await api.call("GET", path), operationId);
    expect(view).toBeTypeOf("object");
  });

  it("answers a finished round's summary by its id, the same one finishing answered", async () => {
    const api = makeApi();
    const summary = await finished(api);
    api.advance(3 * 86_400_000);
    const response = await api.call("GET", "/v1/rounds/p1/summary");
    expect(await contracted(response, "getRoundSummary")).toStrictEqual(summary);
  });

  it.each([
    ["an open round", "p1"],
    ["an id no round has", "p9"],
  ])("does not find the summary of %s", async (_, roundId) => {
    const api = makeApi();
    await startedPlacement(api);
    expect(
      await refusal(await api.call("GET", `/v1/rounds/${roundId}/summary`)),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
  });
});

describe("the commands", () => {
  it("records a batch whose answers carry no roundId, taking the round from the path", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    const batch = batchFor(round);
    const recorded = await api.call("POST", "/v1/rounds/p1/answers", batch);
    expect(recorded.status).toBe(204);
    expect(await recorded.text()).toBe("");
    const again = await api.call("POST", "/v1/rounds/p1/answers", batch);
    expect(again.status).toBe(204);

    const reviews = await api.stores
      .forLearner(learnerId("local-learner"))
      .reviewsOf("p1");
    expect(reviews.map((review) => review.id)).toStrictEqual(
      batch.answers.map((answer) => answer.id).sort(),
    );
  });

  it("resumes the round a retried start made", async () => {
    const api = makeApi();
    const first = await startedPlacement(api);
    const retried = await api.call("POST", "/v1/rounds", {
      roundId: "p1",
      kind: "placement",
    });
    expect(await contracted(retried, "startRound")).toStrictEqual(first);
  });

  it("answers the kept summary when a round is finished twice", async () => {
    const api = makeApi();
    const summary = await finished(api);
    const again = await api.call("POST", "/v1/rounds/p1/finish", { answers: [] });
    expect(await contracted(again, "finishRound")).toStrictEqual(summary);
  });

  it("refuses answers for a round that is not there", async () => {
    const api = makeApi();
    await startedPlacement(api);
    expect(
      await refusal(await api.call("POST", "/v1/rounds/p9/answers", { answers: [] })),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
  });

  it("answers 503 when the catalog cannot be read", async () => {
    const api = makeApi({ catalog: unreadableCatalog });
    expect(
      await refusal(
        await api.call("POST", "/v1/rounds", { roundId: "p1", kind: "placement" }),
      ),
    ).toStrictEqual([503, "ERR_CONTENT_UNREADABLE"]);
  });
});

describe("a request the contract refuses", () => {
  function send(
    api: ApiHarness,
    body: BodyInit,
    init: RequestInit = {},
  ): Promise<Response> {
    return Promise.resolve(
      api.app.fetch(
        new Request("http://localhost/api/v1/settings", {
          method: "PATCH",
          body,
          ...init,
        }),
      ),
    );
  }

  it.each([
    ["a body that is not JSON", "{"],
    ["an empty body", ""],
    ["a JSON array", "[]"],
    ["a bare JSON string", '"work"'],
    ["a value outside the closed set", JSON.stringify({ dailySize: 7 })],
    ["a field of the wrong type", JSON.stringify({ sound: "yes" })],
  ])("answers 400 ERR_BAD_REQUEST for %s", async (_, body) => {
    expect(await refusal(await send(makeApi(), body))).toStrictEqual([
      400,
      "ERR_BAD_REQUEST",
    ]);
  });

  it("answers 413 for a body over the ceiling, whatever Content-Length claims", async () => {
    const body = JSON.stringify({ topics: ["x".repeat(MAX_REQUEST_BODY_BYTES)] });
    expect(await refusal(await send(makeApi(), body))).toStrictEqual([
      413,
      "ERR_PAYLOAD_TOO_LARGE",
    ]);
  });

  it("answers 400 for a body whose stream fails part-way", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("the client hung up"));
      },
    });
    const response = await send(makeApi(), stream, { duplex: "half" } as RequestInit);
    expect(await refusal(response)).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });

  it("answers 400 for a round id longer than the contract allows", async () => {
    const api = makeApi();
    const response = await api.call("GET", `/v1/rounds/${"r".repeat(65)}/summary`);
    expect(await refusal(response)).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });

  it("answers the fixed sentence for the code, never what the request carried", async () => {
    const response = await send(makeApi(), JSON.stringify({ topics: [42] }));
    expect(await response.json()).toStrictEqual({
      error: { code: "ERR_BAD_REQUEST", message: MESSAGE_BY_CODE.ERR_BAD_REQUEST },
    });
  });
});

describe("who a request acts as", () => {
  it("answers 403 for an actor serving another learner than the one authenticated", async () => {
    const local = await localAuthenticator({
      id: "a",
      timeZone: undefined,
    }).authenticate(new Request("http://localhost/"));
    const authenticator: Authenticator = {
      authenticate: () =>
        Promise.resolve({
          ...local,
          actor: { kind: "learner", learnerId: learnerId("b") },
        }),
    };
    const api = makeApi({ authenticator });
    expect(await refusal(await api.call("GET", "/v1/home"))).toStrictEqual([
      403,
      "ERR_FORBIDDEN",
    ]);
  });

  it("answers 403 for an agent not granted the operation", async () => {
    const local = await localAuthenticator({
      id: "a",
      timeZone: undefined,
    }).authenticate(new Request("http://localhost/"));
    const authenticator: Authenticator = {
      authenticate: () =>
        Promise.resolve({
          ...local,
          actor: { kind: "agent", onBehalfOf: local.learner.id, grants: ["home"] },
        }),
    };
    const api = makeApi({ authenticator });
    expect((await api.call("GET", "/v1/home")).status).toBe(200);
    expect(await refusal(await api.call("GET", "/v1/records"))).toStrictEqual([
      403,
      "ERR_FORBIDDEN",
    ]);
  });

  it("does not find another learner's round, and leaves it as it was", async () => {
    const a = makeApi();
    await finished(a);
    const b = makeApi({
      stores: a.stores,
      authenticator: localAuthenticator({ id: "learner-b", timeZone: undefined }),
    });
    const before = await a.call("GET", "/v1/rounds/p1/summary");

    expect(await refusal(await b.call("GET", "/v1/rounds/p1/summary"))).toStrictEqual([
      404,
      "ERR_ROUND_NOT_FOUND",
    ]);
    expect(
      await refusal(await b.call("POST", "/v1/rounds/p1/answers", { answers: [] })),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
    expect(
      await refusal(await b.call("POST", "/v1/rounds/p1/finish", { answers: [] })),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
    const after = await a.call("GET", "/v1/rounds/p1/summary");
    expect(await after.json()).toStrictEqual(await before.json());
  });
});
