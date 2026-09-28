import { describe, expect, it } from "vitest";

import {
  cognitoAuthenticator,
  LOCAL_WEB_ORIGINS,
  localRunAuthenticator,
  SESSION_COOKIE,
  type Authenticator,
} from "@instant-composition/api";
import { learnerId } from "@instant-composition/application";
import { errorResponseSchema, ROUTES } from "@instant-composition/contracts";

import { makeApi, startedPlacement, type ApiHarness } from "./api-harness";
import {
  accessToken,
  CLIENT_ID,
  keySetOf,
  signingKey,
  USER_POOL_ID,
} from "./cognito-tokens";

// The Cognito authenticator over tokens signed with a key generated here and
// handed to the verifier as the pool's key set: the verification that runs is
// aws-jwt-verify's own, and no test asks Cognito for anything.

const KEY = signingKey("pool-key");
const OTHER_KEY = signingKey("pool-key");
const UNPUBLISHED_KEY = signingKey("unpublished-key");
const WEB_ORIGIN = "http://127.0.0.1:5173";

function authenticator(): Authenticator {
  return cognitoAuthenticator({
    userPoolId: USER_POOL_ID,
    clientId: CLIENT_ID,
    webOrigins: [WEB_ORIGIN],
    keySet: keySetOf(KEY),
  });
}

function request(method: string, headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/settings", { method, headers });
}

const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});
const cookie = (token: string): Record<string, string> => ({
  cookie: `theme=dark; ${SESSION_COOKIE}=${token}; other=1`,
});

const SIGNED_IN = { ok: true, value: { subject: "subject-a" } };
const UNAUTHENTICATED = { ok: false, error: { code: "ERR_UNAUTHENTICATED" } };
const FORBIDDEN = { ok: false, error: { code: "ERR_FORBIDDEN" } };

describe("cognitoAuthenticator", () => {
  it("accepts an access token as a Bearer header", async () => {
    const token = accessToken(KEY, "subject-a");
    expect(
      await authenticator().authenticate(request("GET", bearer(token))),
    ).toStrictEqual(SIGNED_IN);
  });

  it("accepts the same token from the session cookie, as the same subject", async () => {
    const token = accessToken(KEY, "subject-a");
    expect(
      await authenticator().authenticate(request("GET", cookie(token))),
    ).toStrictEqual(SIGNED_IN);
  });

  it("takes the scheme's name in any case", async () => {
    const token = accessToken(KEY, "subject-a");
    const headers = { authorization: `bearer ${token}` };
    expect(await authenticator().authenticate(request("GET", headers))).toStrictEqual(
      SIGNED_IN,
    );
  });

  it.each([
    ["no credential at all", {}],
    ["an empty session cookie", { cookie: `${SESSION_COOKIE}=` }],
    ["only other cookies", { cookie: "theme=dark" }],
    [
      "an Authorization header of another scheme",
      { authorization: "Basic dXNlcjpwdw==" },
    ],
    ["a Bearer header with no token", { authorization: "Bearer " }],
  ])("refuses a request carrying %s", async (_, headers) => {
    expect(await authenticator().authenticate(request("GET", headers))).toStrictEqual(
      UNAUTHENTICATED,
    );
  });

  it("judges a request with an Authorization header by that header alone, never the cookie", async () => {
    const valid = accessToken(KEY, "subject-a");
    const headers = { ...cookie(valid), authorization: "Bearer not-a-token" };
    expect(await authenticator().authenticate(request("GET", headers))).toStrictEqual(
      UNAUTHENTICATED,
    );
  });

  const now = Math.floor(Date.now() / 1000);
  it.each([
    ["an expired token", accessToken(KEY, "subject-a", { exp: now - 60 })],
    [
      "a token signed by another key under the pool's key id",
      accessToken(OTHER_KEY, "subject-a"),
    ],
    [
      "a token signed by a key the pool does not publish",
      accessToken(UNPUBLISHED_KEY, "subject-a"),
    ],
    [
      "a token issued to another app client",
      accessToken(KEY, "subject-a", { client_id: "otherclient" }),
    ],
    ["an id token", accessToken(KEY, "subject-a", { token_use: "id", aud: CLIENT_ID })],
    [
      "a token from another user pool",
      accessToken(KEY, "subject-a", {
        iss: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_OtherPool",
      }),
    ],
    ["a token with no subject", accessToken(KEY, "", {})],
    ["a string that is not a JWT", "not-a-token"],
    [
      "an unsigned token",
      `${Buffer.from('{"alg":"none","kid":"pool-key"}').toString("base64url")}.${accessToken(KEY, "subject-a").split(".")[1] ?? ""}.`,
    ],
  ])("refuses %s, by either carrier", async (_, token) => {
    const verify = authenticator();
    expect(await verify.authenticate(request("GET", bearer(token)))).toStrictEqual(
      UNAUTHENTICATED,
    );
    expect(await verify.authenticate(request("GET", cookie(token)))).toStrictEqual(
      UNAUTHENTICATED,
    );
  });

  describe("on a request that changes state", () => {
    const token = accessToken(KEY, "subject-a");

    it("lets the session cookie in from the web client's origin", async () => {
      const headers = { ...cookie(token), origin: WEB_ORIGIN };
      expect(
        await authenticator().authenticate(request("PATCH", headers)),
      ).toStrictEqual(SIGNED_IN);
    });

    it.each([
      ["no Origin header", {}],
      ["another origin", { origin: "https://evil.example" }],
      [
        "the API's own origin, which is not the web client's",
        { origin: "http://localhost" },
      ],
    ])("refuses the session cookie with %s", async (_, origin) => {
      const headers = { ...cookie(token), ...origin };
      expect(
        await authenticator().authenticate(request("POST", headers)),
      ).toStrictEqual(FORBIDDEN);
    });

    it("needs no Origin for a Bearer token, which no browser sends by itself", async () => {
      expect(
        await authenticator().authenticate(request("POST", bearer(token))),
      ).toStrictEqual(SIGNED_IN);
    });
  });
});

describe("localRunAuthenticator", () => {
  it("runs the stand-in when no user pool is configured", async () => {
    const chosen = localRunAuthenticator(null);
    expect(chosen.kind).toBe("local");
    expect(await chosen.authenticator.authenticate(request("GET", {}))).toStrictEqual({
      ok: true,
      value: { subject: "local" },
    });
  });

  it("verifies Cognito access tokens when one is, with the local web client's origins", async () => {
    const chosen = localRunAuthenticator({
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      clientSecret: "testclientsecret1",
      domain: "https://test-pool.auth.ap-northeast-1.amazoncognito.com",
    });
    expect(chosen.kind).toBe("cognito");
    expect(await chosen.authenticator.authenticate(request("GET", {}))).toStrictEqual(
      UNAUTHENTICATED,
    );
    expect(LOCAL_WEB_ORIGINS).toContain(WEB_ORIGIN);
  });
});

describe("the API behind the Cognito authenticator", () => {
  function api(headers: Record<string, string>, shared?: ApiHarness): ApiHarness {
    return makeApi({
      authenticator: authenticator(),
      headers,
      ...(shared === undefined
        ? {}
        : {
            stores: shared.stores,
            directory: shared.directory,
            newLearnerId: () => learnerId("learner-b"),
          }),
    });
  }

  it.each(ROUTES.map((route) => [route.operationId, route] as const))(
    "answers %s without a token with 401 ERR_UNAUTHENTICATED, signing no one in",
    async (_, route) => {
      const anonymous = api({});
      const path = route.path.replace("{roundId}", "p1");
      const response = await anonymous.call(
        route.method.toUpperCase(),
        path,
        route.requestBody === null ? undefined : {},
      );

      expect(response.status).toBe(401);
      expect(errorResponseSchema.parse(await response.json()).error.code).toBe(
        "ERR_UNAUTHENTICATED",
      );
      expect(anonymous.lines).toMatchObject([
        {
          operation: route.operationId,
          outcome: "ERR_UNAUTHENTICATED",
          learnerId: null,
        },
      ]);
    },
  );

  it("signs a Bearer token and the session cookie in as the same learner", async () => {
    const token = accessToken(KEY, "subject-a");
    const native = api(bearer(token));
    await startedPlacement(native);
    const web = makeApi({
      authenticator: authenticator(),
      headers: { ...cookie(token), origin: WEB_ORIGIN },
      stores: native.stores,
      directory: native.directory,
    });

    const answered = await web.call("POST", "/v1/rounds/p1/answers", { answers: [] });

    expect(answered.status).toBe(204);
    expect(web.lines.map((line) => line.learnerId)).toStrictEqual(["learner-1"]);
  });

  it("does not find A's round with B's token, and leaves it as it was", async () => {
    const a = api(bearer(accessToken(KEY, "subject-a")));
    await startedPlacement(a);
    const before = await a.stores.forLearner(learnerId("learner-1")).round("p1");
    const b = api(bearer(accessToken(KEY, "subject-b")), a);

    for (const [method, path, body] of [
      ["GET", "/v1/rounds/p1", undefined],
      ["GET", "/v1/rounds/p1/summary", undefined],
      ["POST", "/v1/rounds/p1/answers", { answers: [] }],
      ["POST", "/v1/rounds/p1/finish", { answers: [] }],
    ] as const) {
      const response = await b.call(method, path, body);
      expect(response.status).toBe(404);
      expect(errorResponseSchema.parse(await response.json()).error.code).toBe(
        "ERR_ROUND_NOT_FOUND",
      );
    }
    expect(b.lines.map((line) => line.learnerId)).toStrictEqual([
      "learner-b",
      "learner-b",
      "learner-b",
      "learner-b",
    ]);
    expect(await a.stores.forLearner(learnerId("learner-1")).round("p1")).toStrictEqual(
      before,
    );
  });
});
