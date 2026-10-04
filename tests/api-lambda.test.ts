import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createMemoryDirectory,
  createMemoryStores,
} from "@instant-composition/adapters";
import {
  LOCAL_WEB_ORIGINS,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  SIGN_IN_COOKIE,
  hostedHandler,
  type Fetch,
  type HostedDependencies,
  type HostedEnv,
  type HttpApiEvent,
  type HttpApiHandler,
  type LogLine,
  type ModelCallLine,
} from "@instant-composition/api";
import { learnerId } from "@instant-composition/application";
import { errorResponseSchema } from "@instant-composition/contracts";

import { fixedCatalog, NOON } from "./application-harness";
import { accessToken, CLIENT_ID, keySetOf, USER_POOL_ID } from "./cognito-tokens";
import { CLIENT_SECRET, DOMAIN, fakeCognito, POOL_KEY } from "./web-session-harness";

// The hosted entry's handler driven as API Gateway's HTTP API drives it: an
// event in payload format 2.0 in, the result API Gateway answers with out. The
// user pool's domain and the Parameters and Secrets extension are fakes, and
// the stores are in memory, so no AWS call is made.

const WEB_ORIGIN = "https://app.example.com";
const SESSION_TOKEN = "session-token-for-tests";
const PARAMETER = "/instant-composition/dev/web-client-secret";
const KEY_PARAMETER = "/instant-composition/dev/app/openrouter-api-key";
/** Not a real key: the fake OpenRouter only checks it arrives. */
const MODEL_KEY = "sk-or-v1-key-for-tests";

const ENV: HostedEnv = {
  region: "ap-northeast-1",
  tableName: "instant-composition-dev",
  catalogPath: "catalog/en/ja.json",
  cognito: {
    userPoolId: USER_POOL_ID,
    clientId: CLIENT_ID,
    domain: DOMAIN,
    clientSecretParameter: PARAMETER,
  },
  web: {
    origins: [WEB_ORIGIN],
    callbackUrl: `${WEB_ORIGIN}/api/v1/auth/callback`,
    signOutUrl: `${WEB_ORIGIN}/`,
  },
  extension: { port: 2773, sessionToken: SESSION_TOKEN },
  model: {
    provider: "openrouter",
    modelId: "anthropic/claude-haiku-4.5",
    keyParameter: KEY_PARAMETER,
  },
};

const SCENE = {
  partner: "Neighbor",
  place: "Elevator",
  relation: "First meeting",
  description: "A neighbor says hello.",
  opening: "Hi! Are you new around here?",
};

/** A chat completion carrying `content`, as OpenRouter answers one. */
const completion = (content: unknown): Response =>
  Response.json({
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 120, completion_tokens: 40, cost: 0.0002 },
  });

interface EventOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly cookies?: readonly string[];
  readonly body?: unknown;
}

/** An HTTP API event for `method` on `target` (path and query), as API Gateway builds one. */
function event(
  method: string,
  target: string,
  options: EventOptions = {},
): HttpApiEvent {
  const [rawPath = "", rawQueryString = ""] = target.split("?");
  const body =
    options.body === undefined
      ? null
      : Buffer.from(JSON.stringify(options.body)).toString("base64");
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath,
    rawQueryString,
    headers: {
      host: "abc123.execute-api.ap-northeast-1.amazonaws.com",
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    ...(options.cookies === undefined ? {} : { cookies: [...options.cookies] }),
    body,
    isBase64Encoded: body !== null,
    requestContext: {
      accountId: "123456789012",
      apiId: "abc123",
      authentication: null,
      authorizer: {},
      domainName: "abc123.execute-api.ap-northeast-1.amazonaws.com",
      domainPrefix: "abc123",
      http: {
        method,
        path: rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.7",
        userAgent: "vitest",
      },
      requestId: "api-gateway-request",
      routeKey: "$default",
      stage: "$default",
      time: "22/Sep/2026:03:00:00 +0000",
      timeEpoch: NOON,
    },
  };
}

const parameter = (type: string, value: string): Response =>
  Response.json({
    Parameter: { Name: PARAMETER, Type: type, Value: value, Version: 1 },
  });

function hosted() {
  const cognito = fakeCognito(POOL_KEY);
  const extensionCalls: Request[] = [];
  const modelCalls: Request[] = [];
  let secretAnswer = (): Response => parameter("SecureString", CLIENT_SECRET);
  let keyAnswer = (): Response => parameter("SecureString", MODEL_KEY);
  const fetch: Fetch = (request) => {
    const url = new URL(request.url);
    if (url.origin === "https://openrouter.ai") {
      modelCalls.push(request);
      return Promise.resolve(completion(SCENE));
    }
    if (url.origin !== "http://localhost:2773") {
      return cognito.fetch(request);
    }
    extensionCalls.push(request);
    return Promise.resolve(
      url.searchParams.get("name") === KEY_PARAMETER ? keyAnswer() : secretAnswer(),
    );
  };
  const stores = createMemoryStores();
  const lines: LogLine[] = [];
  const calls: ModelCallLine[] = [];
  let issued = 0;
  const handler = hostedHandler(ENV, {
    stores,
    directory: createMemoryDirectory(stores),
    catalog: fixedCatalog(),
    newLearnerId: () => learnerId(`learner-${String((issued += 1))}`),
    now: () => NOON,
    requestId: () => "req",
    log: (line) => {
      if ("kind" in line) {
        calls.push(line);
      } else {
        lines.push(line);
      }
    },
    fetch,
    keySet: keySetOf(POOL_KEY),
  });
  return {
    handler,
    cognito,
    lines,
    calls,
    extensionCalls,
    modelCalls,
    answerSecretWith: (answer: () => Response) => {
      secretAnswer = answer;
    },
    answerKeyWith: (answer: () => Response) => {
      keyAnswer = answer;
    },
  };
}

type HttpApiResult = Awaited<ReturnType<HttpApiHandler>>;

/** A response header; API Gateway's HTTP API result carries each as one string. */
function headerOf(result: HttpApiResult, name: string): string | undefined {
  const value = result.headers?.[name];
  if (Array.isArray(value)) throw new Error(`${name} came back multi-valued.`);
  return value;
}

function codeOf(body: string): string {
  return errorResponseSchema.parse(JSON.parse(body)).error.code;
}

/** `name=value` of the result's cookie `name`, as a browser sends it back. */
function cookieOf(cookies: readonly string[] | undefined, name: string): string {
  const line = cookies?.find((cookie) => cookie.startsWith(`${name}=`)) ?? "";
  return line.split(";")[0] ?? "";
}

const bearer = (subject: string): Record<string, string> => ({
  authorization: `Bearer ${accessToken(POOL_KEY, subject)}`,
});

const SETTINGS = { topics: ["work", "travel"], dailySize: 10 };

describe("the hosted entry's handler", () => {
  it("refuses a contract route with no credential: the stand-in is never wired", async () => {
    const { handler, lines } = hosted();

    const result = await handler(event("GET", "/api/v1/home"));

    expect(result.statusCode).toBe(401);
    expect(result.isBase64Encoded).toBe(false);
    expect(codeOf(result.body)).toBe("ERR_UNAUTHENTICATED");
    expect(
      lines.map(({ operation, outcome }) => ({ operation, outcome })),
    ).toStrictEqual([{ operation: "getHome", outcome: "ERR_UNAUTHENTICATED" }]);
  });

  it("serves a request carrying an access token the configured user pool issued", async () => {
    const { handler, lines } = hosted();

    const result = await handler(
      event("GET", "/api/v1/home", { headers: bearer("subject-a") }),
    );

    expect(result.statusCode).toBe(200);
    expect(headerOf(result, "content-type")).toMatch(/^application\/json/);
    expect(lines[0]?.learnerId).toBe("learner-1");
  });

  it("reads a base64-encoded body API Gateway hands over", async () => {
    const { handler } = hosted();

    const result = await handler(
      event("PATCH", "/api/v1/settings", {
        headers: bearer("subject-a"),
        body: SETTINGS,
      }),
    );

    expect(result.statusCode).toBe(200);
  });

  it("admits a session cookie that changes state only from a configured web origin", async () => {
    const { handler } = hosted();
    const cookies = [`${SESSION_COOKIE}=${accessToken(POOL_KEY, "subject-a")}`];
    const patch = (origin: string) =>
      handler(
        event("PATCH", "/api/v1/settings", {
          headers: { origin },
          cookies,
          body: SETTINGS,
        }),
      );

    expect((await patch(WEB_ORIGIN)).statusCode).toBe(200);
    for (const origin of LOCAL_WEB_ORIGINS) {
      const refused = await patch(origin);
      expect(refused.statusCode).toBe(403);
      expect(codeOf(refused.body)).toBe("ERR_FORBIDDEN");
    }
  });

  it("answers a path no route matches with a bare 404", async () => {
    const { handler } = hosted();

    const result = await handler(event("GET", "/api/v1/nowhere"));

    expect(result.statusCode).toBe(404);
    expect(result.body).toBe("");
  });

  it("signs a browser in with the client secret read through the extension", async () => {
    const { handler, cognito, extensionCalls, lines } = hosted();

    const login = await handler(event("GET", "/api/v1/auth/login"));
    expect(login.statusCode).toBe(302);
    const authorize = headerOf(login, "location") ?? "";
    expect(new URL(authorize).searchParams.get("redirect_uri")).toBe(
      ENV.web.callbackUrl,
    );
    expect(headerOf(login, "set-cookie")).toBeUndefined();

    const back = cognito.signIn(authorize, "subject-a");
    const callback = await handler(
      event("GET", `/api/v1/auth/callback?${new URLSearchParams(back).toString()}`, {
        cookies: [cookieOf(login.cookies, SIGN_IN_COOKIE)],
      }),
    );

    expect(callback.statusCode).toBe(302);
    expect(headerOf(callback, "location")).toBe("/");
    expect(cookieOf(callback.cookies, SESSION_COOKIE)).toBe(
      `${SESSION_COOKIE}=${cognito.last().access}`,
    );
    expect(cookieOf(callback.cookies, REFRESH_COOKIE)).toBe(
      `${REFRESH_COOKIE}=${cognito.last().refresh}`,
    );
    expect(cognito.calls.map(({ path }) => path)).toStrictEqual(["/oauth2/token"]);
    expect(
      extensionCalls.map((request) => ({
        name: new URL(request.url).searchParams.get("name"),
        token: request.headers.get("x-aws-parameters-secrets-token"),
      })),
    ).toStrictEqual([
      { name: PARAMETER, token: SESSION_TOKEN },
      { name: PARAMETER, token: SESSION_TOKEN },
    ]);
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(CLIENT_SECRET);
    expect(logged).not.toContain(SESSION_TOKEN);
  });

  it.each([
    [
      "the extension refuses",
      () => Response.json({ message: "denied" }, { status: 403 }),
    ],
    ["the parameter is plain text", () => parameter("String", CLIENT_SECRET)],
    [
      "the parameter holds no client secret",
      () => parameter("SecureString", "not a secret"),
    ],
  ])("fails a sign-in with a bare 500 when %s", async (_, answer) => {
    const { handler, cognito, lines, answerSecretWith } = hosted();
    answerSecretWith(answer);

    const login = await handler(event("GET", "/api/v1/auth/login"));

    expect(login.statusCode).toBe(500);
    expect(login.body).toBe("");
    expect(cognito.calls).toStrictEqual([]);
    expect(lines.map(({ outcome, fault }) => ({ outcome, fault }))).toStrictEqual([
      { outcome: "failed", fault: "SecretParameterError" },
    ]);
    expect(JSON.stringify(lines)).not.toContain(CLIENT_SECRET);
  });

  it("starts a talk on OpenRouter, the key read through the extension for the call", async () => {
    const { handler, extensionCalls, modelCalls, calls, lines } = hosted();

    const result = await handler(
      event("POST", "/api/v1/talks", {
        headers: bearer("subject-a"),
        body: { talkId: "t1" },
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      talkId: "t1",
      opening: SCENE.opening,
    });
    expect(
      extensionCalls.map((request) => new URL(request.url).searchParams.get("name")),
    ).toStrictEqual([KEY_PARAMETER]);
    expect(
      modelCalls.map((request) => request.headers.get("authorization")),
    ).toStrictEqual([`Bearer ${MODEL_KEY}`]);
    expect(calls).toStrictEqual<ModelCallLine[]>([
      {
        kind: "model-call",
        requestId: "req",
        task: "talk-scene",
        promptVersion: "talk-scene@1",
        provider: "openrouter",
        modelId: "anthropic/claude-haiku-4.5",
        outcome: "ok",
        attempt: 1,
        duplicatePossible: false,
        providerOutcome: "known",
        inputTokens: 120,
        outputTokens: 40,
        latencyMs: expect.any(Number) as number,
        costUsd: 0.0002,
      },
    ]);
    expect(JSON.stringify([...lines, ...calls])).not.toContain(MODEL_KEY);
  });

  it("fails a talk with a bare 500 while the key's parameter is missing, and serves the drill", async () => {
    const { handler, answerKeyWith, modelCalls, calls, lines } = hosted();
    answerKeyWith(() =>
      Response.json({ message: "ParameterNotFound" }, { status: 400 }),
    );

    const talk = await handler(
      event("POST", "/api/v1/talks", {
        headers: bearer("subject-a"),
        body: { talkId: "t1" },
      }),
    );
    const home = await handler(
      event("GET", "/api/v1/home", { headers: bearer("subject-a") }),
    );

    expect(talk.statusCode).toBe(500);
    expect(talk.body).toBe("");
    expect(home.statusCode).toBe(200);
    expect(modelCalls).toStrictEqual([]);
    expect(
      lines.map(({ operation, outcome, fault }) => ({ operation, outcome, fault })),
    ).toStrictEqual([
      { operation: "startTalk", outcome: "failed", fault: "SecretParameterError" },
      { operation: "getHome", outcome: "ok", fault: null },
    ]);
    expect(calls.map(({ task, outcome }) => ({ task, outcome }))).toStrictEqual([
      { task: "talk-scene", outcome: "failed" },
    ]);
  });

  it("takes no authenticator, no web session and no model from its caller", () => {
    expectTypeOf<HostedDependencies>().not.toHaveProperty("authenticator");
    expectTypeOf<HostedDependencies>().not.toHaveProperty("webSession");
    expectTypeOf<HostedDependencies>().not.toHaveProperty("model");
  });
});
