import { describe, expect, it, vi } from "vitest";

import type { AnswerInput } from "../src/core/api";
import { requestFinish, requestRound, sendAnswer } from "../src/components/drill/api";

const ANSWER: AnswerInput = {
  id: "r:f:c1",
  roundId: "r",
  cardId: "c1",
  pass: "first",
  result: "ok",
  elapsedMs: 1200,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(respond: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond();
  });
  return calls;
}

describe("requestRound", () => {
  it("posts the kind and answers the round", async () => {
    const calls = stubFetch(() => Promise.resolve(json(200, { id: "r1" })));
    const result = await requestRound("today");
    expect(result).toStrictEqual({ ok: true, value: { id: "r1" } });
    expect(calls[0]?.url).toBe("/api/rounds");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ kind: "today" }));
  });

  it("passes on the server's error code and the count of cards available", async () => {
    stubFetch(() =>
      Promise.resolve(
        json(409, { error: { code: "ERR_NOT_ENOUGH_CARDS", available: 3 } }),
      ),
    );
    expect(await requestRound("today")).toStrictEqual({
      ok: false,
      error: { code: "ERR_NOT_ENOUGH_CARDS", available: 3 },
    });
  });

  it("calls an unreachable server a network error", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await requestRound("today")).toStrictEqual({
      ok: false,
      error: { code: "ERR_NETWORK" },
    });
  });

  it("calls an error body it cannot read a network error", async () => {
    stubFetch(() => Promise.resolve(new Response("oops", { status: 500 })));
    expect(await requestRound("today")).toStrictEqual({
      ok: false,
      error: { code: "ERR_NETWORK" },
    });
  });
});

describe("sendAnswer", () => {
  it.each([
    [204, "sent"],
    [400, "rejected"],
    [404, "rejected"],
    [409, "rejected"],
    [500, "failed"],
    [503, "failed"],
  ] as const)("reads status %i as %s", async (status, outcome) => {
    stubFetch(() => Promise.resolve(new Response(null, { status })));
    expect(await sendAnswer(ANSWER)).toBe(outcome);
  });

  it("reads an unreachable server as failed", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await sendAnswer(ANSWER)).toBe("failed");
  });

  it("posts the answer as JSON", async () => {
    const calls = stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await sendAnswer(ANSWER);
    expect(calls[0]?.url).toBe("/api/answers");
    expect(calls[0]?.init?.body).toBe(JSON.stringify(ANSWER));
  });
});

describe("requestFinish", () => {
  it("posts the round's answers and answers the summary", async () => {
    const calls = stubFetch(() => Promise.resolve(json(200, { roundId: "r" })));
    expect(await requestFinish("r", [ANSWER])).toStrictEqual({
      ok: true,
      value: { roundId: "r" },
    });
    expect(calls[0]?.url).toBe("/api/rounds/finish");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ roundId: "r", answers: [ANSWER] }),
    );
  });
});
