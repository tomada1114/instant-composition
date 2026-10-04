import { createHmac, randomUUID } from "node:crypto";

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

// The API with its web sign-in endpoints in front of a fake user pool, and a
// browser that keeps the cookies the API sets. The fake answers the pool API's
// `InitiateAuth` and the domain's `/oauth2/token` and `/oauth2/revoke` the way
// Cognito documents them — `USER_PASSWORD_AUTH` only with the client's
// `SECRET_HASH`, a wrong password and an unknown user refused alike, a
// temporary password answered with a challenge, the client authenticated by its
// secret at the domain, refresh tokens rotated — so what the endpoints do is
// checked against the pool's rules, not against a recording of the calls.
// Nothing here asserts.

export const DOMAIN = "https://test-pool.auth.ap-northeast-1.amazoncognito.com";
export const CLIENT_SECRET = "testclientsecret1";
export const WEB_ORIGIN = "http://127.0.0.1:5173";
/** The pool API `USER_POOL_ID`'s region serves `InitiateAuth` from. */
export const IDP_URL = "https://cognito-idp.ap-northeast-1.amazonaws.com/";
/** The password every user the harness signs in with has, unless a test says otherwise. */
export const PASSWORD = "Correct horse 1!";

/** The key the fake user pool signs its access tokens with. */
export const POOL_KEY = signingKey("pool-key");

/** One request the API made to the user pool's domain or its API. */
export interface DomainCall {
  readonly path: string;
  readonly authorization: string | null;
  /** The form a domain endpoint was sent; empty for a call to the pool's API. */
  readonly form: Readonly<Record<string, string>>;
  /** The pool API's operation (`X-Amz-Target`), or `null` for a domain endpoint. */
  readonly target: string | null;
  /** The JSON a call to the pool's API carried, or `null` for a domain endpoint. */
  readonly json: unknown;
}

/** What an account in the fake pool answers a correct password with. */
export type AccountState =
  | "confirmed"
  | "NEW_PASSWORD_REQUIRED"
  | "PasswordResetRequiredException"
  | "UserNotConfirmedException";

/** An account in the fake pool, by its email. */
export interface Account {
  readonly subject: string;
  readonly password: string;
  readonly state: AccountState;
}

export interface FakeCognito {
  readonly fetch: Fetch;
  readonly calls: DomainCall[];
  /** Every token and challenge session the pool handed out, in order. */
  readonly issued: string[];
  /** The tokens of the last successful token call. */
  readonly last: () => { readonly access: string; readonly refresh: string };
  /** Creates the account `email`, as an administrator does in the console. */
  readonly addUser: (email: string, account?: Partial<Account>) => Account;
  /** Whether `refreshToken` is still one the pool would honour. */
  readonly honours: (refreshToken: string) => boolean;
  /**
   * Makes every later call answer `status` with an error body, answer what
   * `respond` makes, or fail to connect when `null`.
   */
  readonly breakWith: (answer: number | (() => Response) | null) => void;
}

/** The `SECRET_HASH` the pool expects for `username`, computed apart from the API's own. */
export function expectedSecretHash(username: string): string {
  return createHmac("sha256", CLIENT_SECRET)
    .update(`${username}${CLIENT_ID}`)
    .digest("base64");
}

/** A pool API exception, as the JSON protocol answers one. */
function exception(type: string, message: string): Response {
  return Response.json({ __type: type, message }, { status: 400 });
}

export function fakeCognito(key: SigningKey): FakeCognito {
  const calls: DomainCall[] = [];
  const issued: string[] = [];
  const accounts = new Map<string, Account>();
  const refreshable = new Map<string, string>();
  let broken: number | (() => Response) | null | undefined = undefined;
  let last = { access: "", refresh: "" };
  const clientAuth = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;

  /** A fresh access and refresh token for `subject`, the refresh token honoured once. */
  function issue(subject: string): typeof last {
    last = { access: accessToken(key, subject), refresh: `refresh.${randomUUID()}` };
    refreshable.set(last.refresh, subject);
    issued.push(last.access, last.refresh);
    return last;
  }

  function tokensFor(subject: string): Response {
    const { access, refresh } = issue(subject);
    return Response.json({
      access_token: access,
      id_token: `id.${randomUUID()}`,
      refresh_token: refresh,
      expires_in: 3600,
      token_type: "Bearer",
    });
  }
  const refusedGrant = (): Response =>
    Response.json({ error: "invalid_grant" }, { status: 400 });

  function token(form: URLSearchParams): Response {
    if (form.get("grant_type") === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      const subject = refreshable.get(presented);
      refreshable.delete(presented);
      return subject === undefined ? refusedGrant() : tokensFor(subject);
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  /** `InitiateAuth` as the pool answers it for a client that allows `USER_PASSWORD_AUTH`. */
  function initiateAuth(body: unknown): Response {
    const { AuthFlow, ClientId, AuthParameters } = (body ?? {}) as Record<
      string,
      unknown
    >;
    const parameters = (AuthParameters ?? {}) as Record<string, unknown>;
    const username =
      typeof parameters["USERNAME"] === "string" ? parameters["USERNAME"] : "";
    if (AuthFlow !== "USER_PASSWORD_AUTH" || ClientId !== CLIENT_ID) {
      return exception("InvalidParameterException", "Auth flow not enabled.");
    }
    if (parameters["SECRET_HASH"] !== expectedSecretHash(username)) {
      return exception("NotAuthorizedException", "Unable to verify secret hash.");
    }
    const account = accounts.get(username.toLowerCase());
    // With PreventUserExistenceErrors, an unknown user is refused as a wrong password is.
    if (account === undefined || parameters["PASSWORD"] !== account.password) {
      return exception("NotAuthorizedException", "Incorrect username or password.");
    }
    if (account.state === "NEW_PASSWORD_REQUIRED") {
      const session = `session.${randomUUID()}`;
      issued.push(session);
      return Response.json({
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        ChallengeParameters: { USER_ID_FOR_SRP: account.subject },
        Session: session,
      });
    }
    if (account.state !== "confirmed") {
      return exception(account.state, "The account needs an administrator.");
    }
    const { access, refresh } = issue(account.subject);
    return Response.json({
      AuthenticationResult: {
        AccessToken: access,
        ExpiresIn: 3600,
        IdToken: `id.${randomUUID()}`,
        RefreshToken: refresh,
        TokenType: "Bearer",
      },
      ChallengeParameters: {},
    });
  }

  const fetch: Fetch = async (request) => {
    if (broken === null) {
      throw new TypeError("fetch failed");
    }
    const url = new URL(request.url);
    const text = await request.text();
    const authorization = request.headers.get("authorization");
    const target = request.headers.get("x-amz-target");
    const json = target === null ? null : (JSON.parse(text) as unknown);
    const form = new URLSearchParams(target === null ? text : "");
    calls.push({
      path: url.pathname,
      authorization,
      form: Object.fromEntries(form),
      target,
      json,
    });
    if (typeof broken === "function") {
      return broken();
    }
    if (broken !== undefined) {
      return Response.json({ error: "internal_error" }, { status: broken });
    }
    if (url.href === IDP_URL) {
      return request.method === "POST" &&
        request.headers.get("content-type") === "application/x-amz-json-1.1" &&
        target === "AWSCognitoIdentityProviderService.InitiateAuth"
        ? initiateAuth(json)
        : new Response(null, { status: 404 });
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
    addUser: (email, account = {}) => {
      const added: Account = {
        subject: `sub-${randomUUID()}`,
        password: PASSWORD,
        state: "confirmed",
        ...account,
      };
      accounts.set(email.toLowerCase(), added);
      return added;
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
    /** Sent as JSON when given. */
    body?: unknown,
  ) => Promise<Response>;
}

function browserOn(app: ApiApp): Browser {
  const cookies = new Map<string, string>();
  return {
    cookies,
    request: async (method, path, headers = {}, body) => {
      const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await app.fetch(
        new Request(`http://localhost${API_ROOT}${path}`, {
          method,
          headers: {
            ...(cookie === "" ? {} : { cookie }),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  /**
   * Signs `subject` in as the sign-in page does, posting its email and
   * password to `/login` from the web client's origin; `/login`'s answer. The
   * account `<subject>@example.com` is created first when the pool has none.
   */
  readonly signIn: (subject?: string) => Promise<Response>;
}

export function makeWebApi(wrapProvider?: (fetch: Fetch) => Fetch): WebHarness {
  const cognito = fakeCognito(POOL_KEY);
  const api = makeApi({
    authenticator: cognitoAuthenticator({
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      webOrigins: [WEB_ORIGIN],
      keySet: keySetOf(POOL_KEY),
    }),
    webSession: cognitoWebSession({
      userPoolId: USER_POOL_ID,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      domain: DOMAIN,
      fetch: wrapProvider?.(cognito.fetch) ?? cognito.fetch,
      webOrigins: [WEB_ORIGIN],
    }),
  });
  const browser = browserOn(api.app);
  const signedUp = new Set<string>();
  return {
    api,
    cognito,
    browser,
    signIn: async (subject = "subject-a") => {
      const email = `${subject}@example.com`;
      if (!signedUp.has(email)) {
        cognito.addUser(email, { subject });
        signedUp.add(email);
      }
      return browser.request(
        "POST",
        "/v1/auth/login",
        { origin: WEB_ORIGIN },
        { email, password: PASSWORD },
      );
    },
  };
}
