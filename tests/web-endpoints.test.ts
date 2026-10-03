import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_ROOT,
  getVocab,
  startVocabSession,
  recordVocabAnswers,
  finishVocabSession,
  requestVocabFinish,
  requestVocabSession,
  vocabSearch,
  sendVocabAnswer,
  beginVisit,
  finishRound,
  getHome,
  getRecords,
  getRoundSummary,
  getSettings,
  LOGIN_URL,
  operationUrl,
  REFRESH_URL,
  recordAnswers,
  requestFinish,
  requestRound,
  roundKindFrom,
  sendAnswer,
  startRound,
  updateLevel,
  updateProfile,
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
  grade: "good",
  timedOut: false,
  elapsedMs: 1200,
  answeredAt: 1_790_000_000_000,
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

describe("updateLevel", () => {
  it("patches /api/v1/level with the mode and the level picked, as JSON", async () => {
    const view = { mode: "manual", level: 5, toeic: "730" };
    const calls = stubFetch(() => Promise.resolve(Response.json(view)));
    expect(await updateLevel({ mode: "manual", level: 5 })).toStrictEqual({
      ok: true,
      value: view,
    });
    expect(calls).toStrictEqual([
      {
        url: "/api/v1/level",
        method: "PATCH",
        body: { mode: "manual", level: 5 },
        contentType: "application/json",
      },
    ]);
  });
});

describe("updateProfile", () => {
  it("patches /api/v1/me with the fields to change, as JSON", async () => {
    const calls = stubFetch(() =>
      Promise.resolve(Response.json({ timeZone: "Europe/London" })),
    );
    expect(await updateProfile({ timeZone: "Europe/London" })).toStrictEqual({
      ok: true,
      value: { timeZone: "Europe/London" },
    });
    expect(calls).toStrictEqual([
      {
        url: "/api/v1/me",
        method: "PATCH",
        body: { timeZone: "Europe/London" },
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
          {
            id: "r:f:c1",
            cardId: "c1",
            pass: "first",
            grade: "good",
            timedOut: false,
            elapsedMs: 1200,
            answeredAt: 1_790_000_000_000,
          },
        ],
      },
    });
  });

  it("sends an empty batch for a round with nothing left to add", async () => {
    const calls = stubFetch(() => Promise.resolve(Response.json({ roundId: "r" })));
    await finishRound("r", []);
    expect(calls[0]?.body).toStrictEqual({ answers: [] });
  });

  /** `count` unrecorded answers, each under its own id. */
  function unrecorded(count: number): AnswerInput[] {
    return Array.from({ length: count }, (_, index) => ({
      ...ANSWER,
      id: `r:f:c${String(index)}`,
      cardId: `c${String(index)}`,
    }));
  }

  /** Each call's path and how many answers it carried. */
  function batches(calls: readonly Call[]): [string, number][] {
    return calls.map((call) => [
      call.url,
      (call.body as { answers: unknown[] }).answers.length,
    ]);
  }

  function serveFinish(
    answers: () => Response = () => new Response(null, { status: 204 }),
  ): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        contentType: null,
      });
      return Promise.resolve(
        url.endsWith("/finish") ? Response.json({ roundId: "r" }) : answers(),
      );
    });
    return calls;
  }

  it.each([
    [0, [["/api/v1/rounds/r/finish", 0]]],
    [60, [["/api/v1/rounds/r/finish", 60]]],
    [
      61,
      [
        ["/api/v1/rounds/r/answers", 60],
        ["/api/v1/rounds/r/finish", 1],
      ],
    ],
    [
      130,
      [
        ["/api/v1/rounds/r/answers", 60],
        ["/api/v1/rounds/r/answers", 60],
        ["/api/v1/rounds/r/finish", 10],
      ],
    ],
  ] as const)(
    "sends %i unrecorded answers in batches of at most 60, the last with the finish",
    async (count, expected) => {
      const calls = serveFinish();
      expect(await requestFinish("r", unrecorded(count))).toStrictEqual({
        ok: true,
        value: { roundId: "r" },
      });
      expect(batches(calls)).toStrictEqual(expected);
      expect(
        calls.flatMap((call) =>
          (call.body as { answers: { id: string }[] }).answers.map((a) => a.id),
        ),
      ).toStrictEqual(unrecorded(count).map((a) => a.id));
    },
  );

  it("stops before the finish when a batch could not be sent, so a retry sends it again", async () => {
    const calls = serveFinish(() => new Response(null, { status: 503 }));
    expect(await requestFinish("r", unrecorded(61))).toStrictEqual({
      ok: false,
      error: { code: "ERR_NETWORK" },
    });
    expect(batches(calls)).toStrictEqual([["/api/v1/rounds/r/answers", 60]]);
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
          {
            id: "r:f:c1",
            cardId: "c1",
            pass: "first",
            grade: "good",
            timedOut: false,
            elapsedMs: 1200,
            answeredAt: 1_790_000_000_000,
          },
        ],
      },
    });
  });

  it("leaves the time off an answer queued without one, for the server to stamp", async () => {
    const calls = stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await sendAnswer({
      id: "r:f:c1",
      roundId: "r",
      cardId: "c1",
      pass: "first",
      grade: "again",
      timedOut: true,
      elapsedMs: 1200,
    });
    expect(calls[0]?.body).toStrictEqual({
      answers: [
        {
          id: "r:f:c1",
          cardId: "c1",
          pass: "first",
          grade: "again",
          timedOut: true,
          elapsedMs: 1200,
        },
      ],
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

describe("an unauthenticated answer", () => {
  function stubLocation(): string[] {
    const visited: string[] = [];
    vi.stubGlobal("location", {
      assign: (url: string) => {
        visited.push(url);
      },
    });
    return visited;
  }

  /** Whether `pending` is still unsettled once the browser has been sent to sign in. */
  async function staysPending(
    pending: Promise<unknown>,
    visited: string[],
  ): Promise<boolean> {
    let settled = false;
    void pending.finally(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(visited).toStrictEqual([LOGIN_URL]);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return !settled;
  }

  /** A call answered signed in, which is what makes a later refusal a session that ran out. */
  async function answeredSignedIn(): Promise<void> {
    stubFetch(() => Promise.resolve(Response.json({ settings: {} })));
    expect((await getSettings()).ok).toBe(true);
  }

  beforeEach(() => {
    beginVisit();
  });

  it("refreshes the session once and sends the call again", async () => {
    const visited = stubLocation();
    const answers = [
      envelope(401, "ERR_UNAUTHENTICATED"),
      new Response(null, { status: 204 }),
      Response.json({ settings: {} }),
    ];
    const calls = stubFetch(() =>
      Promise.resolve(answers.shift() ?? envelope(500, "ERR_X")),
    );
    const result = await getSettings();
    expect(result.ok).toBe(true);
    expect(calls.map((call) => [call.method, call.url])).toStrictEqual([
      ["GET", "/api/v1/settings"],
      ["POST", REFRESH_URL],
      ["GET", "/api/v1/settings"],
    ]);
    expect(visited).toStrictEqual([]);
  });

  it.each([
    ["refused", () => envelope(401, "ERR_UNAUTHENTICATED")],
    ["not served (no user pool)", () => new Response("", { status: 404 })],
  ] as const)(
    "sends the browser to sign in, and never settles, when the refresh is %s after a call was answered signed in",
    async (_, refresh) => {
      const visited = stubLocation();
      await answeredSignedIn();
      const answers = [envelope(401, "ERR_UNAUTHENTICATED"), refresh()];
      const calls = stubFetch(() =>
        Promise.resolve(answers.shift() ?? envelope(500, "ERR_X")),
      );
      expect(await staysPending(getHome(), visited)).toBe(true);
      expect(calls.map((call) => call.url)).toStrictEqual([
        "/api/v1/home",
        REFRESH_URL,
      ]);
      expect(visited).toStrictEqual([LOGIN_URL]);
      expect(LOGIN_URL).toBe("/api/v1/auth/login");
    },
  );

  it.each([
    ["refused", () => envelope(401, "ERR_UNAUTHENTICATED")],
    ["not served (no user pool)", () => new Response("", { status: 404 })],
  ] as const)(
    "answers the refusal, and leaves the browser where it is, when the refresh is %s before anything was answered signed in",
    async (_, refresh) => {
      const visited = stubLocation();
      const answers = [envelope(401, "ERR_UNAUTHENTICATED"), refresh()];
      stubFetch(() => Promise.resolve(answers.shift() ?? envelope(500, "ERR_X")));
      expect(await getHome()).toStrictEqual({
        ok: false,
        error: { code: "ERR_UNAUTHENTICATED" },
      });
      expect(visited).toStrictEqual([]);
    },
  );

  it("counts an answer that succeeds only after a refresh as signed in", async () => {
    const visited = stubLocation();
    const answers = [
      envelope(401, "ERR_UNAUTHENTICATED"),
      new Response(null, { status: 204 }),
      Response.json({ settings: {} }),
    ];
    stubFetch(() => Promise.resolve(answers.shift() ?? envelope(500, "ERR_X")));
    expect((await getSettings()).ok).toBe(true);
    const expired = [
      envelope(401, "ERR_UNAUTHENTICATED"),
      envelope(401, "ERR_UNAUTHENTICATED"),
    ];
    stubFetch(() => Promise.resolve(expired.shift() ?? envelope(500, "ERR_X")));
    expect(await staysPending(getHome(), visited)).toBe(true);
    expect(visited).toStrictEqual([LOGIN_URL]);
  });

  it("counts only a successful answer as signed in", async () => {
    const visited = stubLocation();
    const answers = [
      envelope(503, "ERR_CONTENT_UNREADABLE"),
      envelope(401, "ERR_UNAUTHENTICATED"),
      envelope(401, "ERR_UNAUTHENTICATED"),
    ];
    stubFetch(() => Promise.resolve(answers.shift() ?? envelope(500, "ERR_X")));
    await getHome();
    expect((await getHome()).ok).toBe(false);
    expect(visited).toStrictEqual([]);
  });

  it("starts each visit with nobody signed in", async () => {
    const visited = stubLocation();
    await answeredSignedIn();
    beginVisit();
    const answers = [
      envelope(401, "ERR_UNAUTHENTICATED"),
      envelope(401, "ERR_UNAUTHENTICATED"),
    ];
    stubFetch(() => Promise.resolve(answers.shift() ?? envelope(500, "ERR_X")));
    expect((await getHome()).ok).toBe(false);
    expect(visited).toStrictEqual([]);
  });

  it("refreshes at most once when the retry is refused too", async () => {
    const visited = stubLocation();
    await answeredSignedIn();
    const answers = [
      envelope(401, "ERR_UNAUTHENTICATED"),
      new Response(null, { status: 204 }),
      envelope(401, "ERR_UNAUTHENTICATED"),
    ];
    const calls = stubFetch(() =>
      Promise.resolve(answers.shift() ?? envelope(500, "ERR_X")),
    );
    expect(await staysPending(getHome(), visited)).toBe(true);
    expect(calls).toHaveLength(3);
    expect(visited).toStrictEqual([LOGIN_URL]);
  });

  it("leaves any other 401 alone", async () => {
    const visited = stubLocation();
    const calls = stubFetch(() => Promise.resolve(envelope(401, "ERR_OTHER")));
    await getHome();
    expect(calls).toHaveLength(1);
    expect(visited).toStrictEqual([]);
  });
});

describe("vocabulary calls", () => {
  it("reads the hub and starts a category session without a learner id", async () => {
    const calls: { url: unknown; body: unknown }[] = [];
    vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) => {
      calls.push({
        url,
        body:
          typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null,
      });
      return Promise.resolve(Response.json({ value: "fixture" }));
    });
    await getVocab();
    await startVocabSession({ sessionId: "s1", kind: "today", category: "word" });
    expect(calls).toStrictEqual([
      { url: "/api/v1/vocab", body: null },
      {
        url: "/api/v1/vocab/sessions",
        body: { sessionId: "s1", kind: "today", category: "word" },
      },
    ]);
  });
  it.each([
    [204, "", "sent"],
    [409, "ERR_CONFLICT", "failed"],
    [409, "ERR_SESSION_CLOSED", "rejected"],
    [404, "ERR_SESSION_NOT_FOUND", "rejected"],
    [503, "ERR_CONTENT_UNREADABLE", "failed"],
  ] as const)(
    "classifies vocabulary status %s %s as %s",
    async (status, code, expected) => {
      vi.stubGlobal("fetch", () =>
        Promise.resolve(
          status === 204
            ? new Response(null, { status })
            : Response.json({ error: { code } }, { status }),
        ),
      );
      expect(await recordVocabAnswers("s1", [])).toBe(expected);
    },
  );
  it("keeps a vocabulary network failure queued and returns finish errors", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    expect(await sendVocabAnswer(ANSWER)).toBe("failed");
    expect(await finishVocabSession("s1", [])).toStrictEqual({
      ok: false,
      error: { code: "ERR_NETWORK" },
    });
  });
  it("sends more than 60 pending answers in bounded batches, without timer fields", async () => {
    const calls: { url: unknown; body: unknown }[] = [];
    vi.stubGlobal("fetch", (url: unknown, init?: RequestInit) => {
      calls.push({
        url,
        body:
          typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null,
      });
      return Promise.resolve(
        String(url).endsWith("/answers")
          ? new Response(null, { status: 204 })
          : Response.json({ answered: 121 }),
      );
    });
    const inputs = Array.from({ length: 121 }, (_, index) => ({
      ...ANSWER,
      id: `a${String(index)}`,
    }));
    await requestVocabFinish("s1", inputs);
    expect(
      calls.map((call) => [
        (call.url as string).split("/").at(-1),
        (call.body as { answers: unknown[] }).answers.length,
      ]),
    ).toStrictEqual([
      ["answers", 60],
      ["answers", 60],
      ["finish", 1],
    ]);
    expect((calls[0]?.body as { answers: object[] }).answers[0]).not.toHaveProperty(
      "timedOut",
    );
  });
  it("blocks overlapping starts until prior answers drain, preserves failures and retries the same ids", async () => {
    const stored = JSON.stringify([ANSWER]);
    const data = new Map([["vocab-answers:r", stored]]);
    vi.stubGlobal("window", {
      sessionStorage: {
        get length() {
          return data.size;
        },
        key: (index: number) => [...data.keys()][index] ?? null,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      },
    });
    let finish: (response: Response) => void = () => undefined;
    const sending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const failedCalls = stubFetch(() => sending);
    const first = requestVocabSession({ kind: "today" }, "new");
    const second = requestVocabSession({ kind: "today" }, "new");
    await Promise.resolve();
    expect(failedCalls.map((call) => call.url)).toStrictEqual([
      "/api/v1/vocab/sessions/r/answers",
    ]);
    finish(envelope(503, "ERR_CONTENT_UNREADABLE"));
    expect(await Promise.all([first, second])).toStrictEqual([
      { ok: false, error: { code: "ERR_NETWORK" } },
      { ok: false, error: { code: "ERR_NETWORK" } },
    ]);
    expect(data.get("vocab-answers:r")).toBe(stored);
    let completeRetry: (response: Response) => void = () => undefined;
    const retrySending = new Promise<Response>((resolve) => {
      completeRetry = resolve;
    });
    let retriedRequests = 0;
    const retried = stubFetch(() => {
      retriedRequests += 1;
      return retriedRequests === 1
        ? retrySending
        : Promise.resolve(Response.json({ sessionId: "new" }));
    });
    const retryFirst = requestVocabSession({ kind: "today" }, "new");
    const retrySecond = requestVocabSession({ kind: "today" }, "new");
    await Promise.resolve();
    expect(retried.map((call) => call.url)).toStrictEqual([
      "/api/v1/vocab/sessions/r/answers",
    ]);
    completeRetry(new Response(null, { status: 204 }));
    expect(
      (await Promise.all([retryFirst, retrySecond])).map((result) => result.ok),
    ).toStrictEqual([true, true]);
    expect(retried.map((call) => call.url)).toStrictEqual([
      "/api/v1/vocab/sessions/r/answers",
      "/api/v1/vocab/sessions",
      "/api/v1/vocab/sessions",
    ]);
    expect(retried[0]?.body).toStrictEqual(failedCalls[0]?.body);
    expect(retried.slice(1).map((call) => call.body)).toStrictEqual([
      { sessionId: "new", kind: "today" },
      { sessionId: "new", kind: "today" },
    ]);
    expect(data.has("vocab-answers:r")).toBe(false);
  });
  it("stops finishing on a failed earlier vocabulary batch", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", (url: unknown) => {
      sent.push(url);
      return Promise.resolve(new Response(null, { status: 503 }));
    });
    expect(
      await requestVocabFinish(
        "s1",
        Array.from({ length: 61 }, () => ANSWER),
      ),
    ).toStrictEqual({ ok: false, error: { code: "ERR_NETWORK" } });
    expect(sent).toStrictEqual(["/api/v1/vocab/sessions/s1/answers"]);
  });
  it.each([
    [{}, { kind: "today" }],
    [{ kind: "bogus", category: "bogus" }, { kind: "today" }],
    [
      { kind: "weak", category: "phrase" },
      { kind: "weak", category: "phrase" },
    ],
  ])("normalizes vocabulary search %j", (search, expected) => {
    expect(vocabSearch(search)).toStrictEqual(expected);
  });
});
