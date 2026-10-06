import { describe, expect, it } from "vitest";

import { createOpenRouterModel, type Fetch } from "@instant-composition/adapters";
import type { AbortSignalLike } from "@instant-composition/application";

import { describeLanguageModelContract, makeRequest } from "./language-model-contract";

// The OpenRouter adapter against a fake `fetch` answering with responses
// shaped as OpenRouter's chat completions endpoint answers: no network, no key.

const MODEL_ID = "anthropic/claude-haiku-4.5";
const KEY = "sk-or-v1-key-for-tests";

/** A chat completion as OpenRouter answers one, its first choice carrying `content`. */
function completion(
  content: string,
  usage: unknown = {
    prompt_tokens: 812,
    completion_tokens: 9,
    total_tokens: 821,
    cost: 0.000857,
    is_byok: false,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 0 },
  },
): Response {
  return Response.json({
    id: "gen-1759300000-AbCdEfGhIjKlMnOpQrSt",
    provider: "Anthropic",
    model: MODEL_ID,
    object: "chat.completion",
    created: 1_759_300_000,
    choices: [
      {
        logprobs: null,
        finish_reason: "stop",
        native_finish_reason: "end_turn",
        index: 0,
        message: { role: "assistant", content, refusal: null, reasoning: null },
      },
    ],
    usage,
  });
}

/** A fake OpenRouter endpoint: it keeps each request and answers with `respond`. */
function openRouter(respond: (request: Request) => Promise<Response> | Response): {
  readonly fetch: Fetch;
  readonly requests: Request[];
} {
  const requests: Request[] = [];
  return {
    requests,
    fetch: async (request) => {
      requests.push(request);
      return respond(request);
    },
  };
}

/** A clock that moves 250 ms each time it is read. */
function ticking(): () => number {
  let at = 1_000;
  return () => {
    at += 250;
    return at;
  };
}

function model(fetch: Fetch, apiKey = () => Promise.resolve(KEY)) {
  return createOpenRouterModel({ fetch, apiKey, modelId: MODEL_ID, now: ticking() });
}

/** Settles once `signal` aborts, as a real `fetch` does with the request's signal. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

/** An AbortSignal that counts the listeners the adapter leaves on it. */
function trackedSignal(): {
  signal: AbortSignalLike;
  abort: () => void;
  listening: () => number;
} {
  const controller = new AbortController();
  let listening = 0;
  return {
    abort: () => {
      controller.abort();
    },
    listening: () => listening,
    signal: {
      get aborted() {
        return controller.signal.aborted;
      },
      addEventListener(type, listener, options) {
        listening += 1;
        controller.signal.addEventListener(type, listener, options);
      },
      removeEventListener(type, listener) {
        listening -= 1;
        controller.signal.removeEventListener(type, listener);
      },
    },
  };
}

const failure = (
  reason: string,
  detail: { httpStatus?: number; requestFailure?: string; causeCode?: string } = {},
) => ({
  ok: false,
  error: { code: "ERR_MODEL_UNAVAILABLE", reason, ...detail },
});

const live = (): AbortSignal => new AbortController().signal;

describeLanguageModelContract("OpenRouter", (output) =>
  model(openRouter(() => completion(JSON.stringify(output))).fetch),
);

describe("createOpenRouterModel", () => {
  it("posts the request to the chat completions endpoint with the key as a Bearer token", async () => {
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));

    await model(endpoint.fetch).generate(makeRequest(), live());

    const [request] = endpoint.requests;
    expect(endpoint.requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(request?.headers.get("content-type")).toBe("application/json");
  });

  it("sends the system prompt, the messages, the schema as strict structured output, and the sampling", async () => {
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));

    await model(endpoint.fetch).generate(makeRequest(), live());

    expect(await endpoint.requests[0]?.json()).toStrictEqual({
      model: "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: "You are a friendly local." },
        { role: "assistant", content: "Hi! Where are you from?" },
        { role: "user", content: "<japanese>東京です</japanese> I'm from Tokyo." },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "partner_line",
          strict: true,
          schema: {
            type: "object",
            properties: { line: { type: "string" } },
            required: ["line"],
            additionalProperties: false,
          },
        },
      },
      provider: { require_parameters: true, data_collection: "deny" },
      temperature: 0.7,
      max_tokens: 150,
    });
  });

  it("answers the parsed line with a call record from usage and its own timer", async () => {
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));

    const result = await model(endpoint.fetch).generate(makeRequest(), live());

    expect(result).toStrictEqual({
      ok: true,
      value: {
        value: { line: "Oh, nice." },
        call: {
          provider: "openrouter",
          modelId: "anthropic/claude-haiku-4.5",
          inputTokens: 812,
          outputTokens: 9,
          latencyMs: 250,
          costUsd: 0.000857,
        },
      },
    });
  });

  it.each([
    ["a null usage", null, { inputTokens: 0, outputTokens: 0, costUsd: null }],
    [
      "usage without a cost",
      { prompt_tokens: 812, completion_tokens: 9 },
      { inputTokens: 812, outputTokens: 9, costUsd: null },
    ],
    [
      "usage whose counts are not counts",
      { prompt_tokens: "812", completion_tokens: -1, cost: "free" },
      { inputTokens: 0, outputTokens: 0, costUsd: null },
    ],
  ])(
    "still answers when the completion reports %s",
    async (_label, usage, reported) => {
      const endpoint = openRouter(() => completion('{"line":"Oh, nice."}', usage));

      const result = await model(endpoint.fetch).generate(makeRequest(), live());

      expect(result.ok && result.value.call).toMatchObject(reported);
    },
  );

  it("still answers, with no counts and no cost, when the completion carries no usage", async () => {
    const endpoint = openRouter(() =>
      Response.json({ choices: [{ message: { content: '{"line":"Oh, nice."}' } }] }),
    );

    const result = await model(endpoint.fetch).generate(makeRequest(), live());

    expect(result.ok && result.value.call).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    });
  });

  it("times the call on performance.now() when no clock is given", async () => {
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));
    const unclocked = createOpenRouterModel({
      fetch: endpoint.fetch,
      apiKey: () => Promise.resolve(KEY),
      modelId: MODEL_ID,
    });

    const result = await unclocked.generate(makeRequest(), live());

    expect(result.ok && result.value.call.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("asks for the key on every call, so a rotated key is used without a restart", async () => {
    const keys = ["sk-or-v1-first", "sk-or-v1-rotated"];
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));
    const rotating = model(endpoint.fetch, () => Promise.resolve(keys.shift() ?? ""));

    await rotating.generate(makeRequest(), live());
    await rotating.generate(makeRequest(), live());

    expect(
      endpoint.requests.map((request) => request.headers.get("authorization")),
    ).toStrictEqual(["Bearer sk-or-v1-first", "Bearer sk-or-v1-rotated"]);
  });

  it("lets a key that cannot be read reject the call, without asking OpenRouter", async () => {
    const unreadable = new Error("The key parameter could not be read.");
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));

    await expect(
      model(endpoint.fetch, () => Promise.reject(unreadable)).generate(
        makeRequest(),
        live(),
      ),
    ).rejects.toBe(unreadable);
    expect(endpoint.requests).toHaveLength(0);
  });

  it.each([
    ["prose around the JSON", 'Sure! {"line": "Oh, nice."}'],
    ["an empty content", ""],
    ["JSON cut off at the token limit", '{"line": "Oh, ni'],
  ])("answers malformed for a content of %s", async (_label, content) => {
    const endpoint = openRouter(() => completion(content));

    const result = await model(endpoint.fetch).generate(makeRequest(), live());

    expect(result).toStrictEqual(failure("malformed"));
  });

  it.each([
    ["no choices", { choices: [] }],
    [
      "a message with no content",
      { choices: [{ message: { role: "assistant", content: null } }] },
    ],
    ["an error object", { error: { code: 502, message: "upstream failed" } }],
  ])("answers malformed for a 200 carrying %s", async (_label, body) => {
    const endpoint = openRouter(() => Response.json(body));

    const result = await model(endpoint.fetch).generate(makeRequest(), live());

    expect(result).toStrictEqual(failure("malformed"));
  });

  it.each([
    [429, "throttled"],
    [401, "denied"],
    [403, "denied"],
    [400, "transport"],
    [402, "transport"],
    [404, "transport"],
    [500, "transport"],
    [502, "transport"],
    [503, "transport"],
  ])("answers a %i with %s, carrying the status", async (status, reason) => {
    const endpoint = openRouter(() =>
      Response.json({ error: { code: status, message: "refused" } }, { status }),
    );

    const result = await model(endpoint.fetch).generate(makeRequest(), live());

    expect(result).toStrictEqual(failure(reason, { httpStatus: status }));
  });

  it("releases the body of a refusal instead of leaving it unread", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel: () => {
        cancelled = true;
      },
    });
    const endpoint = openRouter(() => new Response(body, { status: 429 }));

    await model(endpoint.fetch).generate(makeRequest(), live());

    expect(cancelled).toBe(true);
  });

  it("answers transport from the network when the endpoint cannot be reached", async () => {
    const endpoint = openRouter(() => Promise.reject(new TypeError("fetch failed")));

    const result = await model(endpoint.fetch).generate(makeRequest(), live());

    expect(result).toStrictEqual(failure("transport", { requestFailure: "network" }));
  });

  it.each<[string, Error, { causeCode?: string }]>([
    [
      "the code undici puts on its cause",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND openrouter.ai"), {
          code: "ENOTFOUND",
        }),
      }),
      { causeCode: "ENOTFOUND" },
    ],
    [
      "the first code of an AggregateError cause",
      new TypeError("fetch failed", {
        cause: new AggregateError([
          Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
        ]),
      }),
      { causeCode: "ETIMEDOUT" },
    ],
    [
      "no code when the cause carries none",
      new TypeError("fetch failed", { cause: new Error("bad port") }),
      {},
    ],
    [
      "no code when it is not an identifier",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("x"), { code: "Bearer sk-or-v1-secret" }),
      }),
      {},
    ],
  ])("answers a network failure with %s", async (_label, thrown, code) => {
    const endpoint = openRouter(() => Promise.reject(thrown));

    const result = await model(endpoint.fetch).generate(makeRequest(), live());

    expect(result).toStrictEqual(
      failure("transport", { requestFailure: "network", ...code }),
    );
  });

  it("answers transport from the request's construction, naming no key, when the key cannot be a header", async () => {
    const badKey = "sk-or-v1-key\nwith-a-line-break";
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));

    const result = await model(endpoint.fetch, () => Promise.resolve(badKey)).generate(
      makeRequest(),
      live(),
    );

    expect(result).toStrictEqual(
      failure("transport", { requestFailure: "request-construction" }),
    );
    expect(endpoint.requests).toHaveLength(0);
  });

  it("answers transport from the response body when a 200's body is not JSON", async () => {
    const endpoint = openRouter(
      () => new Response("<html>gateway</html>", { status: 200 }),
    );

    const result = await model(endpoint.fetch).generate(makeRequest(), live());

    expect(result).toStrictEqual(
      failure("transport", { requestFailure: "response-body" }),
    );
  });

  it("answers timeout without asking OpenRouter when the signal has already aborted", async () => {
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));
    const controller = new AbortController();
    controller.abort();

    const result = await model(endpoint.fetch).generate(
      makeRequest(),
      controller.signal,
    );

    expect(result).toStrictEqual(failure("timeout"));
    expect(endpoint.requests).toHaveLength(0);
  });

  it("answers timeout without asking OpenRouter when the signal aborts while the key is read", async () => {
    const tracked = trackedSignal();
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));
    const slowKey = () => {
      tracked.abort();
      return Promise.resolve(KEY);
    };

    const result = await model(endpoint.fetch, slowKey).generate(
      makeRequest(),
      tracked.signal,
    );

    expect(result).toStrictEqual(failure("timeout"));
    expect(endpoint.requests).toHaveLength(0);
    expect(tracked.listening()).toBe(0);
  });

  it("aborts the request in flight and answers timeout when the signal aborts", async () => {
    const tracked = trackedSignal();
    const endpoint = openRouter((request) => {
      const pending = untilAborted(request.signal);
      tracked.abort();
      return pending;
    });

    const result = await model(endpoint.fetch).generate(makeRequest(), tracked.signal);

    expect(result).toStrictEqual(failure("timeout"));
    expect(endpoint.requests[0]?.signal.aborted).toBe(true);
    expect(tracked.listening()).toBe(0);
  });

  it("aborts the body being read and answers timeout when the signal aborts", async () => {
    const tracked = trackedSignal();
    const endpoint = openRouter((request) => {
      const body = new ReadableStream({
        start(controller) {
          request.signal.addEventListener("abort", () => {
            controller.error(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        },
      });
      queueMicrotask(tracked.abort);
      return new Response(body, { status: 200 });
    });

    const result = await model(endpoint.fetch).generate(makeRequest(), tracked.signal);

    expect(result).toStrictEqual(failure("timeout"));
    expect(endpoint.requests[0]?.signal.aborted).toBe(true);
  });

  it("removes its abort listener once a call has answered", async () => {
    const tracked = trackedSignal();
    const endpoint = openRouter(() => completion('{"line":"Oh, nice."}'));

    const result = await model(endpoint.fetch).generate(makeRequest(), tracked.signal);

    expect(result.ok).toBe(true);
    expect(tracked.listening()).toBe(0);
  });
});
