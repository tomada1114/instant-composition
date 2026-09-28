import { createHash, randomUUID } from "node:crypto";

import {
  API_ROOT,
  cognitoAuthenticator,
  cognitoWebSession,
  type ApiApp,
  type Fetch,
} from "@instant-composition/api";

import { makeApi, type ApiHarness } from "./api-harness";
import {
  accessToken,
  CLIENT_ID,
  keySetOf,
  signingKey,
  USER_POOL_ID,
  type SigningKey,
} from "./cognito-tokens";

// The API with its web sign-in endpoints in front of a fake user pool domain,
// and a browser that keeps the cookies the API sets. The fake answers
// `/oauth2/token` and `/oauth2/revoke` the way Cognito documents them — client
// authenticated by its secret, a code redeemable once and only with the
// verifier whose S256 challenge the sign-in sent, refresh tokens rotated — so
// what the endpoints do is checked against the pool's rules, not against a
// recording of the calls. Nothing here asserts.

export const DOMAIN = "https://test-pool.auth.ap-northeast-1.amazoncognito.com";
export const CLIENT_SECRET = "testclientsecret1";
export const WEB_ORIGIN = "http://127.0.0.1:5173";
export const CALLBACK_URL = "http://127.0.0.1:5173/api/v1/auth/callback";
export const SIGN_OUT_URL = "http://127.0.0.1:5173/";

/** The key the fake user pool signs its access tokens with. */
export const POOL_KEY = signingKey("pool-key");

/** One request the API made to the user pool's domain. */
export interface DomainCall {
  readonly path: string;
  readonly authorization: string | null;
  readonly form: Readonly<Record<string, string>>;
}

export interface FakeCognito {
  readonly fetch: Fetch;
  readonly calls: DomainCall[];
  /** Every token, code and `state` the pool handed out, in order. */
  readonly issued: string[];
  /** The tokens of the last successful token call. */
  readonly last: () => { readonly access: string; readonly refresh: string };
  /**
   * The managed login signing `subject` in, for the sign-in that was sent to
   * `authorizeUrl`: the code and `state` it sends the browser back with.
   */
  readonly signIn: (
    authorizeUrl: string,
    subject: string,
  ) => { readonly code: string; readonly state: string };
  /** Whether `refreshToken` is still one the pool would honour. */
  readonly honours: (refreshToken: string) => boolean;
  /**
   * Makes every later call answer `status` with an error body, answer what
   * `respond` makes, or fail to connect when `null`.
   */
  readonly breakWith: (answer: number | (() => Response) | null) => void;
}

const s256 = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

export function fakeCognito(key: SigningKey): FakeCognito {
  const calls: DomainCall[] = [];
  const issued: string[] = [];
  const codes = new Map<
    string,
    {
      readonly challenge: string;
      readonly redirectUri: string;
      readonly subject: string;
    }
  >();
  const refreshable = new Map<string, string>();
  let broken: number | (() => Response) | null | undefined = undefined;
  let last = { access: "", refresh: "" };
  const clientAuth = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;

  function tokensFor(subject: string): Response {
    last = { access: accessToken(key, subject), refresh: `refresh.${randomUUID()}` };
    refreshable.set(last.refresh, subject);
    issued.push(last.access, last.refresh);
    return Response.json({
      access_token: last.access,
      id_token: `id.${randomUUID()}`,
      refresh_token: last.refresh,
      expires_in: 3600,
      token_type: "Bearer",
    });
  }
  const refusedGrant = (): Response =>
    Response.json({ error: "invalid_grant" }, { status: 400 });

  function token(form: URLSearchParams): Response {
    if (form.get("grant_type") === "authorization_code") {
      const code = form.get("code") ?? "";
      const pending = codes.get(code);
      codes.delete(code);
      if (
        form.get("redirect_uri") !== pending?.redirectUri ||
        s256(form.get("code_verifier") ?? "") !== pending.challenge
      ) {
        return refusedGrant();
      }
      return tokensFor(pending.subject);
    }
    if (form.get("grant_type") === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      const subject = refreshable.get(presented);
      refreshable.delete(presented);
      return subject === undefined ? refusedGrant() : tokensFor(subject);
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const fetch: Fetch = async (request) => {
    if (broken === null) {
      throw new TypeError("fetch failed");
    }
    const url = new URL(request.url);
    const form = new URLSearchParams(await request.text());
    const authorization = request.headers.get("authorization");
    calls.push({ path: url.pathname, authorization, form: Object.fromEntries(form) });
    if (typeof broken === "function") {
      return broken();
    }
    if (broken !== undefined) {
      return Response.json({ error: "internal_error" }, { status: broken });
    }
    if (
      url.origin !== DOMAIN ||
      request.method !== "POST" ||
      request.headers.get("content-type") !== "application/x-www-form-urlencoded"
    ) {
      return new Response(null, { status: 404 });
    }
    if (authorization !== clientAuth || form.get("client_id") !== CLIENT_ID) {
      return Response.json({ error: "invalid_client" }, { status: 400 });
    }
    if (url.pathname === "/oauth2/revoke") {
      refreshable.delete(form.get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    return url.pathname === "/oauth2/token"
      ? token(form)
      : new Response(null, { status: 404 });
  };

  return {
    fetch,
    calls,
    issued,
    last: () => last,
    signIn: (authorizeUrl, subject) => {
      const url = new URL(authorizeUrl);
      const params = url.searchParams;
      if (
        `${url.origin}${url.pathname}` !== `${DOMAIN}/oauth2/authorize` ||
        params.get("response_type") !== "code" ||
        params.get("client_id") !== CLIENT_ID ||
        params.get("code_challenge_method") !== "S256"
      ) {
        throw new Error("The managed login refuses this authorization request.");
      }
      const code = randomUUID();
      const state = params.get("state") ?? "";
      codes.set(code, {
        challenge: params.get("code_challenge") ?? "",
        redirectUri: params.get("redirect_uri") ?? "",
        subject,
      });
      issued.push(code, state);
      return { code, state };
    },
    honours: (refreshToken) => refreshable.has(refreshToken),
    breakWith: (answer) => {
      broken = answer;
    },
  };
}

/** A browser on the web client's page: it sends and keeps the cookies the API sets. */
export interface Browser {
  readonly cookies: Map<string, string>;
  readonly request: (
    method: string,
    path: string,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<Response>;
}

function browserOn(app: ApiApp): Browser {
  const cookies = new Map<string, string>();
  return {
    cookies,
    request: async (method, path, headers = {}) => {
      const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await app.fetch(
        new Request(`http://localhost${API_ROOT}${path}`, {
          method,
          headers: { ...(cookie === "" ? {} : { cookie }), ...headers },
        }),
      );
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";")[0] ?? "";
        const at = pair.indexOf("=");
        if (/; Max-Age=0(;|$)/u.test(line)) {
          cookies.delete(pair.slice(0, at));
        } else {
          cookies.set(pair.slice(0, at), pair.slice(at + 1));
        }
      }
      return response;
    },
  };
}

export interface WebHarness {
  readonly api: ApiHarness;
  readonly cognito: FakeCognito;
  readonly browser: Browser;
  /** Signs `subject` in through `/login`, the managed login and `/callback`; the callback's answer. */
  readonly signIn: (subject?: string) => Promise<Response>;
}

export function makeWebApi(): WebHarness {
  const cognito = fakeCognito(POOL_KEY);
  const api = makeApi({
    authenticator: cognitoAuthenticator({
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      webOrigins: [WEB_ORIGIN],
      keySet: keySetOf(POOL_KEY),
    }),
    webSession: cognitoWebSession({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      domain: DOMAIN,
      fetch: cognito.fetch,
      webOrigins: [WEB_ORIGIN],
      callbackUrl: CALLBACK_URL,
      signOutUrl: SIGN_OUT_URL,
    }),
  });
  const browser = browserOn(api.app);
  return {
    api,
    cognito,
    browser,
    signIn: async (subject = "subject-a") => {
      const login = await browser.request("GET", "/v1/auth/login");
      const back = cognito.signIn(login.headers.get("location") ?? "", subject);
      return browser.request(
        "GET",
        `/v1/auth/callback?${new URLSearchParams(back).toString()}`,
      );
    },
  };
}
