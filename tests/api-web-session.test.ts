import { describe, expect, it } from "vitest";

import {
  identityProviderUrl,
  LOCAL_WEB_ORIGINS,
  localRunWebSession,
  MAX_REQUEST_BODY_BYTES,
  REFRESH_COOKIE,
  secretHash,
  SESSION_COOKIE,
  SIGN_IN_PAGE,
  type LogLine,
} from "@instant-composition/api";
import { errorResponseSchema } from "@instant-composition/contracts";

import { makeApi } from "./api-harness";
import { CLIENT_ID } from "./cognito-tokens";
import {
  CLIENT_SECRET,
  DOMAIN,
  expectedSecretHash,
  IDP_URL,
  makeWebApi,
  PASSWORD,
  WEB_ORIGIN,
  type WebHarness,
} from "./web-session-harness";

// The web sign-in endpoints the API hosts, driven through the app
// against a fake user pool (tests/web-session-harness.ts): Cognito is never
// called, and no real credential is used.

const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";
const FROM_PAGE = { origin: WEB_ORIGIN };
const EMAIL = "learner@example.com";

async function codeOf(response: Response): Promise<string> {
  return errorResponseSchema.parse(await response.json()).error.code;
}

/** Posts `credentials` to `/login` as the sign-in page does. */
function signInWith(
  web: WebHarness,
  credentials: { readonly email: string; readonly password: string },
): Promise<Response> {
  return web.browser.request("POST", "/v1/auth/login", FROM_PAGE, credentials);
}

/** A pool API exception, as the JSON protocol answers one. */
function exception(type: string): Response {
  return Response.json({ __type: type, message: "A message." }, { status: 400 });
}

describe("POST /v1/auth/login", () => {
  it("signs a confirmed account in through InitiateAuth with the client's SECRET_HASH, keeping the tokens in HttpOnly cookies", async () => {
    const web = makeWebApi();
    web.cognito.addUser(EMAIL);
    const response = await signInWith(web, { email: EMAIL, password: PASSWORD });
    const { access, refresh } = web.cognito.last();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.getSetCookie()).toStrictEqual([
      `${SESSION_COOKIE}=${access}; Max-Age=3600; ${ATTRIBUTES}`,
      `${REFRESH_COOKIE}=${refresh}; Max-Age=2592000; ${ATTRIBUTES}`,
    ]);
    expect(web.cognito.calls).toStrictEqual([
      {
        path: "/",
        authorization: null,
        form: {},
        target: "AWSCognitoIdentityProviderService.InitiateAuth",
        json: {
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: CLIENT_ID,
          AuthParameters: {
            USERNAME: EMAIL,
            PASSWORD,
            SECRET_HASH: expectedSecretHash(EMAIL),
          },
        },
      },
    ]);
  });

  it("signs the browser in to the API with the cookie it set, and a refresh renews it at the token endpoint", async () => {
    const web = makeWebApi();
    await web.signIn("subject-a");

    const home = await web.browser.request("GET", "/v1/home");
    const saved = await web.browser.request("PATCH", "/v1/settings", FROM_PAGE);
    const renewed = await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE);
    const after = await web.browser.request("GET", "/v1/home");

    expect(home.status).toBe(200);
    expect(saved.status).toBe(400);
    expect(renewed.status).toBe(204);
    expect(after.status).toBe(200);
    expect(web.cognito.calls.map(({ path }) => path)).toStrictEqual([
      "/",
      "/oauth2/token",
    ]);
    expect(
      web.api.lines
        .filter((line) => line.learnerId !== null)
        .map((line) => line.learnerId),
    ).toStrictEqual(["learner-1", "learner-1", "learner-1"]);
  });

  it("signs any account in through the same endpoint, each to its own learner", async () => {
    const web = makeWebApi();
    await web.signIn("subject-a");
    await web.browser.request("GET", "/v1/home");
    await web.signIn("subject-b");
    await web.browser.request("GET", "/v1/home");
    await web.signIn("subject-a");
    await web.browser.request("GET", "/v1/home");

    expect(
      web.api.lines
        .filter((line) => line.learnerId !== null)
        .map((line) => line.learnerId),
    ).toStrictEqual(["learner-1", "learner-2", "learner-1"]);
  });

  it.each([
    ["a wrong password", { email: EMAIL, password: `${PASSWORD}x` }],
    [
      "an email the pool has no account for",
      { email: "nobody@example.com", password: PASSWORD },
    ],
  ])(
    "refuses %s as ERR_UNAUTHENTICATED, setting no cookie and keeping the browser's own",
    async (_, credentials) => {
      const web = makeWebApi();
      web.cognito.addUser(EMAIL);
      await web.signIn("subject-a");
      const before = new Map(web.browser.cookies);
      const response = await signInWith(web, credentials);

      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe("ERR_UNAUTHENTICATED");
      expect(response.headers.getSetCookie()).toStrictEqual([]);
      expect(web.browser.cookies).toStrictEqual(before);
    },
  );

  it.each([
    ["a temporary password (NEW_PASSWORD_REQUIRED)", "NEW_PASSWORD_REQUIRED"],
    ["a reset the pool demands", "PasswordResetRequiredException"],
    ["an unconfirmed account", "UserNotConfirmedException"],
  ] as const)(
    "answers %s as ERR_SIGN_IN_ACTION_REQUIRED, issuing no session and answering no challenge",
    async (_, state) => {
      const web = makeWebApi();
      web.cognito.addUser(EMAIL, { state });
      const response = await signInWith(web, { email: EMAIL, password: PASSWORD });
      const text = await response.text();

      expect(response.status).toBe(403);
      expect(errorResponseSchema.parse(JSON.parse(text)).error.code).toBe(
        "ERR_SIGN_IN_ACTION_REQUIRED",
      );
      expect(response.headers.getSetCookie()).toStrictEqual([]);
      expect(web.browser.cookies.size).toBe(0);
      expect(web.cognito.calls).toHaveLength(1);
      for (const issued of web.cognito.issued) {
        expect(text).not.toContain(issued);
      }
      expect((await web.browser.request("GET", "/v1/home")).status).toBe(401);
    },
  );

  it.each([
    ["no Origin", {}],
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["the API's own origin", { origin: "http://localhost" }],
  ])(
    "refuses a sign-in with %s as ERR_FORBIDDEN, sending nothing to the pool",
    async (_, headers) => {
      const web = makeWebApi();
      web.cognito.addUser(EMAIL);
      const response = await web.browser.request("POST", "/v1/auth/login", headers, {
        email: EMAIL,
        password: PASSWORD,
      });

      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("ERR_FORBIDDEN");
      expect(web.cognito.calls).toStrictEqual([]);
      expect(response.headers.getSetCookie()).toStrictEqual([]);
    },
  );

  it.each([
    ["no body", undefined],
    ["a body that is not an object", ["a", "b"]],
    ["no email", { password: PASSWORD }],
    ["no password", { email: EMAIL }],
    ["an empty email", { email: "", password: PASSWORD }],
    ["an empty password", { email: EMAIL, password: "" }],
    ["an email that is not a string", { email: 7, password: PASSWORD }],
    [
      "an email longer than 320",
      { email: `${"a".repeat(309)}@example.com`, password: PASSWORD },
    ],
    ["a password longer than 256", { email: EMAIL, password: "p".repeat(257) }],
  ])("refuses %s as ERR_BAD_REQUEST, sending nothing to the pool", async (_, body) => {
    const web = makeWebApi();
    const response = await web.browser.request(
      "POST",
      "/v1/auth/login",
      FROM_PAGE,
      body,
    );

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("ERR_BAD_REQUEST");
    expect(web.cognito.calls).toStrictEqual([]);
  });

  it("refuses a body that is not JSON, and one too large, before calling the pool", async () => {
    const web = makeWebApi();
    const send = async (body: string): Promise<Response> =>
      await web.api.app.fetch(
        new Request("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
          body,
        }),
      );

    expect((await send("email=a&password=b")).status).toBe(400);
    expect((await send(" ".repeat(MAX_REQUEST_BODY_BYTES + 1))).status).toBe(413);
    expect(web.cognito.calls).toStrictEqual([]);
  });

  it.each([
    ["answers a server error", 500, "InitiateAuthError"],
    [
      "throttles the call",
      () => exception("TooManyRequestsException"),
      "InitiateAuthError",
    ],
    [
      "does not allow the flow for the client",
      () => exception("InvalidParameterException"),
      "InitiateAuthError",
    ],
    ["cannot be reached", null, "TypeError"],
    [
      "answers a body that is not JSON",
      () => new Response("<html></html>"),
      "InitiateAuthError",
    ],
    [
      "answers no refresh token",
      () =>
        Response.json({
          AuthenticationResult: { AccessToken: "a.b.c", ExpiresIn: 3600 },
        }),
      "InitiateAuthError",
    ],
    [
      "answers an access token no cookie can carry",
      () =>
        Response.json({
          AuthenticationResult: {
            AccessToken: "a;b",
            ExpiresIn: 3600,
            RefreshToken: "r",
          },
        }),
      "InitiateAuthError",
    ],
    [
      "answers a lifetime of zero",
      () =>
        Response.json({
          AuthenticationResult: {
            AccessToken: "a.b.c",
            ExpiresIn: 0,
            RefreshToken: "r",
          },
        }),
      "InitiateAuthError",
    ],
  ] as const)(
    "answers a bare 500 when the pool %s, keeping no cookie and logging no credential",
    async (_, broken, fault) => {
      const web = makeWebApi();
      web.cognito.addUser(EMAIL);
      web.cognito.breakWith(broken);
      const response = await signInWith(web, { email: EMAIL, password: PASSWORD });

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("");
      expect(web.browser.cookies.size).toBe(0);
      expect(web.api.lines.at(-1)).toMatchObject({
        operation: "signIn",
        outcome: "failed",
        fault,
      });
      const logged = JSON.stringify(web.api.lines);
      for (const secret of [
        EMAIL,
        PASSWORD,
        CLIENT_SECRET,
        expectedSecretHash(EMAIL),
      ]) {
        expect(logged).not.toContain(secret);
      }
    },
  );

  it("writes no email, password, secret or token into a response or a log line", async () => {
    const web = makeWebApi();
    web.cognito.addUser(EMAIL);
    web.cognito.addUser("temporary@example.com", { state: "NEW_PASSWORD_REQUIRED" });
    const answers = [
      await signInWith(web, { email: EMAIL, password: PASSWORD }),
      await signInWith(web, { email: EMAIL, password: "wrong password" }),
      await signInWith(web, { email: "temporary@example.com", password: PASSWORD }),
    ];
    const bodies = await Promise.all(answers.map((answer) => answer.text()));
    const written = JSON.stringify([web.api.lines, bodies]);
    const headers = JSON.stringify(
      answers.map((answer) =>
        [...answer.headers].filter(([name]) => name !== "set-cookie"),
      ),
    );

    expect(answers.map((answer) => answer.status)).toStrictEqual([204, 401, 403]);
    for (const secret of [
      EMAIL,
      "temporary@example.com",
      PASSWORD,
      "wrong password",
      CLIENT_SECRET,
      ...web.cognito.issued,
    ]) {
      expect(written).not.toContain(secret);
      expect(headers).not.toContain(secret);
    }
  });
});

describe("the pool's API for a user pool", () => {
  it.each([
    ["ap-northeast-1_TestPool1", "https://cognito-idp.ap-northeast-1.amazonaws.com/"],
    ["eu-west-2_AbC123", "https://cognito-idp.eu-west-2.amazonaws.com/"],
  ])("is the regional endpoint for %s", (pool, url) => {
    expect(identityProviderUrl(pool)).toBe(url);
  });

  it("proves the client with HMAC-SHA256 of the username and client id under the secret", async () => {
    const client = {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      domain: DOMAIN,
      fetch: () => Promise.reject(new Error("unused")),
    };

    expect(await secretHash(client, EMAIL)).toBe(expectedSecretHash(EMAIL));
    expect(await secretHash(client, "Other@Example.com")).toBe(
      expectedSecretHash("Other@Example.com"),
    );
  });
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

  it("refuses an expired refresh without clearing another request's newer cookies", async () => {
    const web = makeWebApi();
    await web.signIn();
    web.browser.cookies.set(REFRESH_COOKIE, "refresh.revoked-long-ago");
    const response = await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE);

    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("ERR_UNAUTHENTICATED");
    expect(response.headers.getSetCookie()).toStrictEqual([]);
  });
});

describe("a refresh the pool answers with something other than a token set", () => {
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
      "a refresh token no cookie can carry",
      () => Response.json({ ...tokens, refresh_token: 7 }),
    ],
    [
      "a server error",
      () => Response.json({ error: "internal_error" }, { status: 500 }),
    ],
    [
      "a refused client",
      () => Response.json({ error: "invalid_client" }, { status: 400 }),
    ],
  ])("fails with a bare 500 on %s, changing no cookie", async (_, respond) => {
    const web = makeWebApi();
    await web.signIn();
    const before = new Map(web.browser.cookies);
    web.cognito.breakWith(respond);
    const response = await web.browser.request("POST", "/v1/auth/refresh", FROM_PAGE);

    expect(response.status).toBe(500);
    expect(web.browser.cookies).toStrictEqual(before);
    expect(web.api.lines.at(-1)).toMatchObject({
      operation: "refreshSession",
      outcome: "failed",
      fault: "TokenEndpointError",
    });
  });
});

describe("POST /v1/auth/logout", () => {
  it("revokes the refresh token, drops the cookies and sends the browser to the app's own sign-in page", async () => {
    const web = makeWebApi();
    await web.signIn();
    const { refresh } = web.cognito.last();
    const response = await web.browser.request("POST", "/v1/auth/logout", FROM_PAGE);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(SIGN_IN_PAGE).toBe("/login");
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

  it("sends a browser with no session to the sign-in page all the same", async () => {
    const web = makeWebApi();
    const response = await web.browser.request("POST", "/v1/auth/logout", FROM_PAGE);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
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
      { operation: "signIn", outcome: "ok", status: 204, learnerId: null },
      { operation: "refreshSession", outcome: "ok", status: 204, learnerId: null },
      { operation: "signOut", outcome: "ERR_FORBIDDEN", status: 403, learnerId: null },
    ]);
  });

  it("serves no sign-in endpoint when the app is given no web session, as with the stand-in", async () => {
    const api = makeApi();
    const answers = [
      await api.call("POST", "/v1/auth/login", { email: EMAIL, password: PASSWORD }),
      await api.call("POST", "/v1/auth/refresh"),
      await api.call("POST", "/v1/auth/logout"),
    ];

    expect(answers.map((answer) => answer.status)).toStrictEqual([404, 404, 404]);
    expect(api.lines).toMatchObject([
      { operation: null, outcome: "unmatched" },
      { operation: null, outcome: "unmatched" },
      { operation: null, outcome: "unmatched" },
    ]);
  });

  it("serves no managed-login redirect or callback any more", async () => {
    const web = makeWebApi();
    const login = await web.browser.request("GET", "/v1/auth/login");
    const callback = await web.browser.request(
      "GET",
      "/v1/auth/callback?code=a&state=b",
    );

    expect([login.status, callback.status]).toStrictEqual([404, 404]);
    expect(web.cognito.calls).toStrictEqual([]);
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

  it("signs a local run's page in through the pool's region, from the Vite servers' origins alone", async () => {
    const sent: Request[] = [];
    const session = localRunWebSession(settings, (request) => {
      sent.push(request);
      return Promise.resolve(
        Response.json({ ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "s" }),
      );
    });
    const post = (origin: string) =>
      session?.signIn(
        new Request("http://localhost/api/v1/auth/login", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
        }),
      );

    for (const origin of LOCAL_WEB_ORIGINS) {
      expect((await post(origin))?.outcome).toBe("ERR_SIGN_IN_ACTION_REQUIRED");
    }
    expect((await post("http://localhost:8787"))?.outcome).toBe("ERR_FORBIDDEN");
    expect(sent.map((request) => request.url)).toStrictEqual(
      LOCAL_WEB_ORIGINS.map(() => IDP_URL),
    );
    expect(LOCAL_WEB_ORIGINS).toStrictEqual([
      "http://127.0.0.1:5173",
      "http://127.0.0.1:4173",
    ]);
  });
});
