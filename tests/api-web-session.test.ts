import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LOCAL_SIGN_IN_URLS,
  LOCAL_WEB_ORIGINS,
  localRunWebSession,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  SIGN_IN_COOKIE,
  type LogLine,
} from "@instant-composition/api";
import { errorResponseSchema } from "@instant-composition/contracts";

import { makeApi } from "./api-harness";
import { CLIENT_ID } from "./cognito-tokens";
import {
  CALLBACK_URL,
  CLIENT_SECRET,
  DOMAIN,
  makeWebApi,
  SIGN_OUT_URL,
  WEB_ORIGIN,
  type WebHarness,
} from "./web-session-harness";

// The web sign-in endpoints ADR-0005 has the API host, driven through the app
// against a fake user pool domain (tests/web-session-harness.ts): Cognito is
// never called.

const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";
const FROM_PAGE = { origin: WEB_ORIGIN };

async function codeOf(response: Response): Promise<string> {
  return errorResponseSchema.parse(await response.json()).error.code;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** Starts a sign-in and has the managed login send `subject` back; the callback's query. */
async function backFromLogin(web: WebHarness, subject = "subject-a") {
  const login = await web.browser.request("GET", "/v1/auth/login");
  return web.cognito.signIn(login.headers.get("location") ?? "", subject);
}

describe("GET /v1/auth/login", () => {
  it("sends the browser to the managed login with a state and an S256 PKCE challenge", async () => {
    const web = makeWebApi();
    const response = await web.browser.request("GET", "/v1/auth/login");
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(`${DOMAIN}/oauth2/authorize`);
    expect(Object.fromEntries(location.searchParams)).toStrictEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      scope: "openid",
      state: expect.stringMatching(/^[\w-]{43}$/u) as string,
      code_challenge: expect.stringMatching(/^[\w-]{43}$/u) as string,
      code_challenge_method: "S256",
    });
    expect(response.headers.getSetCookie()).toStrictEqual([
      expect.stringMatching(
        new RegExp(`^${SIGN_IN_COOKIE}=[\\w.-]+; Max-Age=600; ${ATTRIBUTES}$`, "u"),
      ) as string,
    ]);
  });

  it("starts every sign-in with a state and a challenge of its own", async () => {
    const web = makeWebApi();
    const first = new URL(
      (await web.browser.request("GET", "/v1/auth/login")).headers.get("location") ??
        "",
    );
    const second = new URL(
      (await web.browser.request("GET", "/v1/auth/login")).headers.get("location") ??
        "",
    );

    expect(second.searchParams.get("state")).not.toBe(first.searchParams.get("state"));
    expect(second.searchParams.get("code_challenge")).not.toBe(
      first.searchParams.get("code_challenge"),
    );
  });
});

describe("GET /v1/auth/callback", () => {
  it("redeems the code with the client secret and the verifier, and keeps the tokens in HttpOnly cookies", async () => {
    const web = makeWebApi();
    const login = await web.browser.request("GET", "/v1/auth/login");
    const authorize = new URL(login.headers.get("location") ?? "");
    const back = web.cognito.signIn(authorize.href, "subject-a");
    const response = await web.browser.request(
      "GET",
      `/v1/auth/callback?${query(back)}`,
    );
    const { access, refresh } = web.cognito.last();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.getSetCookie()).toStrictEqual([
      `${SIGN_IN_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`,
      `${SESSION_COOKIE}=${access}; Max-Age=3600; ${ATTRIBUTES}`,
      `${REFRESH_COOKIE}=${refresh}; Max-Age=2592000; ${ATTRIBUTES}`,
    ]);
    const [call] = web.cognito.calls;
    expect(call?.path).toBe("/oauth2/token");
    expect(call?.authorization).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    );
    expect(call?.form).toMatchObject({
      grant_type: "authorization_code",
      code: back.code,
      redirect_uri: CALLBACK_URL,
    });
    expect(
      createHash("sha256")
        .update(call?.form["code_verifier"] ?? "")
        .digest("base64url"),
    ).toBe(authorize.searchParams.get("code_challenge"));
    expect(response.headers.get("location")).not.toContain(CLIENT_SECRET);
  });

  it("signs the browser in to the API with the cookie it set", async () => {
    const web = makeWebApi();
    await web.signIn("subject-a");

    const home = await web.browser.request("GET", "/v1/home");
    const saved = await web.browser.request("PATCH", "/v1/settings", FROM_PAGE);

    expect(home.status).toBe(200);
    expect(saved.status).toBe(400);
    expect(web.api.lines.slice(-2).map((line) => line.learnerId)).toStrictEqual([
      "learner-1",
      "learner-1",
    ]);
  });

  it.each([
    ["no sign-in cookie", (web: WebHarness) => web.browser.cookies.clear()],
    [
      "a sign-in cookie of another shape",
      (web: WebHarness) => web.browser.cookies.set(SIGN_IN_COOKIE, "x.y"),
    ],
  ])(
    "refuses a callback with %s as ERR_FORBIDDEN, redeeming nothing",
    async (_, spoil) => {
      const web = makeWebApi();
      const back = await backFromLogin(web);
      spoil(web);
      const response = await web.browser.request(
        "GET",
        `/v1/auth/callback?${query(back)}`,
      );

      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("ERR_FORBIDDEN");
      expect(web.cognito.calls).toStrictEqual([]);
      expect(web.browser.cookies.has(SESSION_COOKIE)).toBe(false);
    },
  );

  it.each([
    ["another sign-in's state", (state: string) => `${state.slice(1)}A`],
    ["no state", () => undefined],
    ["a state of another length", (state: string) => state.slice(1)],
  ])(
    "refuses a callback carrying %s as ERR_FORBIDDEN, redeeming nothing",
    async (_, stateOf) => {
      const web = makeWebApi();
      const back = await backFromLogin(web);
      const state = stateOf(back.state);
      const response = await web.browser.request(
        "GET",
        `/v1/auth/callback?${query({ code: back.code, ...(state === undefined ? {} : { state }) })}`,
      );

      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("ERR_FORBIDDEN");
      expect(web.cognito.calls).toStrictEqual([]);
      expect(web.browser.cookies.has(SIGN_IN_COOKIE)).toBe(false);
    },
  );

  it("answers a sign-in the managed login ended without a code as ERR_UNAUTHENTICATED", async () => {
    const web = makeWebApi();
    const { state } = await backFromLogin(web);
    const response = await web.browser.request(
      "GET",
      `/v1/auth/callback?${query({ error: "access_denied", state })}`,
    );

    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("ERR_UNAUTHENTICATED");
    expect(web.cognito.calls).toStrictEqual([]);
  });

  it("answers a code the pool refuses as ERR_UNAUTHENTICATED, keeping no token", async () => {
    const web = makeWebApi();
    const { state } = await backFromLogin(web);
    const response = await web.browser.request(
      "GET",
      `/v1/auth/callback?${query({ code: "not-a-code-the-pool-issued", state })}`,
    );

    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("ERR_UNAUTHENTICATED");
    expect([...web.browser.cookies.keys()]).toStrictEqual([]);
  });

  it("does not redeem one callback twice", async () => {
    const web = makeWebApi();
    const back = await backFromLogin(web);
    await web.browser.request("GET", `/v1/auth/callback?${query(back)}`);
    const replayed = await web.browser.request(
      "GET",
      `/v1/auth/callback?${query(back)}`,
    );

    expect(replayed.status).toBe(403);
    expect(web.cognito.calls).toHaveLength(1);
  });

  it.each([
    ["answers a server error", 500],
    ["refuses the client", 400],
  ] as const)("answers a bare 500 when the pool %s", async (_, status) => {
    const web = makeWebApi();
    const back = await backFromLogin(web);
    web.cognito.breakWith(status);
    const response = await web.browser.request(
      "GET",
      `/v1/auth/callback?${query(back)}`,
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(web.api.lines.at(-1)).toMatchObject({
      operation: "finishSignIn",
      outcome: "failed",
      fault: "TokenEndpointError",
    });
  });
});

describe("an answer from the pool that is not a token set", () => {
  const tokens = {
    access_token: "header.payload.signature",
    refresh_token: "refresh.token",
    expires_in: 3600,
  };

  it.each([
    ["a body that is not JSON", () => new Response("<html></html>", { status: 200 })],
    ["no access token", () => Response.json({ ...tokens, access_token: undefined })],
    [
      "an access token no cookie can carry",
      () => Response.json({ ...tokens, access_token: "a;b" }),
    ],
    [
      "a lifetime that is not a number",
      () => Response.json({ ...tokens, expires_in: "3600" }),
    ],
    ["a lifetime of zero", () => Response.json({ ...tokens, expires_in: 0 })],
    [
      "no refresh token for a code",
      () => Response.json({ ...tokens, refresh_token: undefined }),
    ],
    [
      "a refresh token no cookie can carry",
      () => Response.json({ ...tokens, refresh_token: 7 }),
    ],
  ])(
    "fails the callback with a bare 500 on %s, keeping no cookie",
    async (_, respond) => {
      const web = makeWebApi();
      const back = await backFromLogin(web);
      web.cognito.breakWith(respond);
      const response = await web.browser.request(
        "GET",
        `/v1/auth/callback?${query(back)}`,
      );

      expect(response.status).toBe(500);
      expect(web.browser.cookies.has(SESSION_COOKIE)).toBe(false);
      expect(web.api.lines.at(-1)).toMatchObject({
        outcome: "failed",
        fault: "TokenEndpointError",
      });
    },
  );
});

describe("POST /v1/auth/refresh", () => {
  it("renews the access token and keeps the rotated refresh token", async () => {
    const web = makeWebApi();
    await web.signIn();
    const before = web.cognito.last();
    const response = await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE);
    const after = web.cognito.last();

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toStrictEqual([
      `${SESSION_COOKIE}=${after.access}; Max-Age=3600; ${ATTRIBUTES}`,
      `${REFRESH_COOKIE}=${after.refresh}; Max-Age=2592000; ${ATTRIBUTES}`,
    ]);
    expect(web.cognito.calls.at(-1)?.form).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: before.refresh,
    });
    expect(web.cognito.honours(before.refresh)).toBe(false);
    expect(
      (await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE)).status,
    ).toBe(204);
  });

  it("keeps the refresh token when the pool issues no new one", async () => {
    const web = makeWebApi();
    await web.signIn();
    const { refresh } = web.cognito.last();
    web.cognito.breakWith(() =>
      Response.json({ access_token: "renewed.access.token", expires_in: 300 }),
    );
    const response = await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE);

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toStrictEqual([
      `${SESSION_COOKIE}=renewed.access.token; Max-Age=300; ${ATTRIBUTES}`,
    ]);
    expect(web.browser.cookies.get(REFRESH_COOKIE)).toBe(refresh);
  });

  it.each([
    ["no Origin", {}],
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["the API's own origin", { origin: "http://localhost" }],
  ])(
    "refuses a refresh with %s as ERR_FORBIDDEN, sending nothing to the pool",
    async (_, headers) => {
      const web = makeWebApi();
      await web.signIn();
      const calls = web.cognito.calls.length;
      const response = await web.browser.request("POST", "/v1/auth/refresh", headers);

      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("ERR_FORBIDDEN");
      expect(web.cognito.calls).toHaveLength(calls);
      expect(response.headers.getSetCookie()).toStrictEqual([]);
    },
  );

  it("answers a browser with no refresh token as ERR_UNAUTHENTICATED", async () => {
    const web = makeWebApi();
    const response = await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE);

    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("ERR_UNAUTHENTICATED");
    expect(web.cognito.calls).toStrictEqual([]);
  });

  it("drops the session when the pool refuses the refresh token", async () => {
    const web = makeWebApi();
    await web.signIn();
    web.browser.cookies.set(REFRESH_COOKIE, "refresh.revoked-long-ago");
    const response = await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE);

    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("ERR_UNAUTHENTICATED");
    expect(response.headers.getSetCookie()).toStrictEqual([
      `${SESSION_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`,
      `${REFRESH_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`,
    ]);
  });
});

describe("POST /v1/auth/logout", () => {
  it("revokes the refresh token, drops the cookies and signs out of the managed login", async () => {
    const web = makeWebApi();
    await web.signIn();
    const { refresh } = web.cognito.last();
    const response = await web.browser.request("POST", "/v1/auth/logout", FROM_PAGE);
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(`${location.origin}${location.pathname}`).toBe(`${DOMAIN}/logout`);
    expect(Object.fromEntries(location.searchParams)).toStrictEqual({
      client_id: CLIENT_ID,
      logout_uri: SIGN_OUT_URL,
    });
    expect(response.headers.getSetCookie()).toStrictEqual([
      `${SESSION_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`,
      `${REFRESH_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`,
    ]);
    expect(web.cognito.calls.at(-1)?.path).toBe("/oauth2/revoke");
    expect(web.cognito.honours(refresh)).toBe(false);
    expect((await web.browser.request("GET", "/v1/home")).status).toBe(401);
  });

  it.each([
    ["cannot be reached", null],
    ["answers a server error", 500],
  ] as const)("signs out even when the pool %s to revoke", async (_, broken) => {
    const web = makeWebApi();
    await web.signIn();
    web.cognito.breakWith(broken);
    const response = await web.browser.request("POST", "/v1/auth/logout", FROM_PAGE);

    expect(response.status).toBe(303);
    expect([...web.browser.cookies.keys()]).toStrictEqual([]);
  });

  it("signs a browser with no session out of the managed login all the same", async () => {
    const web = makeWebApi();
    const response = await web.browser.request("POST", "/v1/auth/logout", FROM_PAGE);

    expect(response.status).toBe(303);
    expect(web.cognito.calls).toStrictEqual([]);
  });

  it.each([
    ["no Origin", {}],
    ["a foreign Origin", { origin: "https://evil.example" }],
  ])(
    "refuses a logout with %s as ERR_FORBIDDEN, keeping the session",
    async (_, headers) => {
      const web = makeWebApi();
      await web.signIn();
      const { refresh } = web.cognito.last();
      const response = await web.browser.request("POST", "/v1/auth/logout", headers);

      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("ERR_FORBIDDEN");
      expect(web.cognito.honours(refresh)).toBe(true);
      expect([...web.browser.cookies.keys()].sort()).toStrictEqual(
        [REFRESH_COOKIE, SESSION_COOKIE].sort(),
      );
    },
  );
});

describe("the web session beside the rest of the API", () => {
  it("leaves a Bearer request that changes state needing no Origin", async () => {
    const web = makeWebApi();
    await web.signIn();
    const response = await web.api.app.fetch(
      new Request("http://localhost/api/v1/settings", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${web.cognito.last().access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ topics: ["work", "travel"], dailySize: 10 }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("logs each endpoint under its own operation, with no learner", async () => {
    const web = makeWebApi();
    await web.signIn();
    await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE);
    await web.browser.request("POST", "/v1/auth/logout", {});

    expect(
      web.api.lines.map(({ operation, outcome, status, learnerId }) => ({
        operation,
        outcome,
        status,
        learnerId,
      })),
    ).toStrictEqual<Pick<LogLine, "operation" | "outcome" | "status" | "learnerId">[]>([
      { operation: "startSignIn", outcome: "ok", status: 302, learnerId: null },
      { operation: "finishSignIn", outcome: "ok", status: 302, learnerId: null },
      { operation: "refreshSession", outcome: "ok", status: 204, learnerId: null },
      { operation: "signOut", outcome: "ERR_FORBIDDEN", status: 403, learnerId: null },
    ]);
  });

  it("serves no sign-in endpoint when the app is given no web session", async () => {
    const api = makeApi();
    const response = await api.call("GET", "/v1/auth/login");

    expect(response.status).toBe(404);
    expect(api.lines).toMatchObject([{ operation: null, outcome: "unmatched" }]);
  });
});

describe("localRunWebSession", () => {
  const settings = {
    userPoolId: "ap-northeast-1_TestPool1",
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    domain: DOMAIN,
  };

  it("serves none with the stand-in", () => {
    expect(localRunWebSession(null, () => Promise.reject(new Error("unused")))).toBe(
      undefined,
    );
  });

  it("sends a local run's browser back through the Vite dev server's proxy", async () => {
    const session = localRunWebSession(settings, () =>
      Promise.reject(new Error("unused")),
    );
    const answered = await session?.startSignIn(
      new Request("http://localhost/api/v1/auth/login"),
    );
    const location = new URL(answered?.response.headers.get("location") ?? "");

    expect(location.origin).toBe(DOMAIN);
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:5173/api/v1/auth/callback",
    );
    // The URLs tests/infra-foundation.test.ts holds the dev web client to.
    expect(LOCAL_SIGN_IN_URLS).toStrictEqual({
      callbackUrl: "http://127.0.0.1:5173/api/v1/auth/callback",
      signOutUrl: "http://127.0.0.1:5173/",
    });
    expect(LOCAL_WEB_ORIGINS).toContain(new URL(LOCAL_SIGN_IN_URLS.callbackUrl).origin);
  });
});
