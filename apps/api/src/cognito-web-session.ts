import type { ErrorCode } from "@instant-composition/contracts";

import { SESSION_COOKIE } from "./cognito-authenticator";
import { clearCookie, cookieValue, setCookie } from "./cookies";
import { failure, readJsonBody } from "./http";
import { signInWithPassword, type PasswordClient } from "./initiate-auth";
import { refreshTokens, revokeToken, type IssuedTokens } from "./token-endpoint";
import type { WebSession, WebSessionAnswer } from "./web-session";

/** The cookie the session's refresh token is kept in, beside {@link SESSION_COOKIE}. */
export const REFRESH_COOKIE = "__Host-refresh-token";

/** The web client's own sign-in page, where `/logout` leaves the browser. */
export const SIGN_IN_PAGE = "/login";

/**
 * How long the browser keeps the refresh token: the web app client's refresh
 * token validity, Cognito's default of 30 days, which the foundation stack
 * leaves as it is. A cookie kept past its token only earns a refused refresh.
 */
const REFRESH_SECONDS = 30 * 24 * 60 * 60;

/**
 * The longest email and password a sign-in carries to the pool: an email
 * address is at most 320 characters and a Cognito password at most 256.
 */
const MAX_EMAIL = 320;
const MAX_PASSWORD = 256;

export interface CognitoWebSessionOptions extends PasswordClient {
  /** The web client's origins: every endpoint refuses a request from any other. */
  readonly webOrigins: readonly string[];
}

interface Credentials {
  readonly email: string;
  readonly password: string;
}

function answer(
  response: Response,
  outcome: WebSessionAnswer["outcome"],
): WebSessionAnswer {
  return { response, outcome };
}

function withCookies(response: Response, cookies: readonly string[]): Response {
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

function refused(code: ErrorCode, cookies: readonly string[] = []): WebSessionAnswer {
  return answer(withCookies(failure(code), cookies), code);
}

function keep(tokens: IssuedTokens): string[] {
  return [
    setCookie(SESSION_COOKIE, tokens.accessToken, tokens.expiresIn),
    ...(tokens.refreshToken === undefined
      ? []
      : [setCookie(REFRESH_COOKIE, tokens.refreshToken, REFRESH_SECONDS)]),
  ];
}

const DROP_SESSION = [clearCookie(SESSION_COOKIE), clearCookie(REFRESH_COOKIE)];

function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** The email and password a sign-in's JSON body carries, or `undefined` for any other body. */
function credentialsOf(body: unknown): Credentials | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { email, password } = body as Readonly<Record<string, unknown>>;
  return bounded(email, MAX_EMAIL) && bounded(password, MAX_PASSWORD)
    ? { email, password }
    : undefined;
}

/**
 * The web session over a Cognito user pool's confidential app client: the
 * email and password the web client's own sign-in page posts, signed in
 * through the pool's `InitiateAuth` with a `SECRET_HASH` from the client
 * secret the server alone holds, and the tokens set as `__Host-` cookies that
 * are HttpOnly, Secure and SameSite=Lax. The tokens never reach a page script.
 *
 * @remarks
 * Every endpoint is called from a page, so, as on the rest of the cookie
 * path, a missing or foreign `Origin` is `ERR_FORBIDDEN` before anything is
 * read. A sign-in the pool refuses sets no cookie and leaves any it finds:
 * `ERR_UNAUTHENTICATED` for credentials that sign nobody in,
 * `ERR_SIGN_IN_ACTION_REQUIRED` for an account an administrator must act on
 * first. The password reaches the pool and nothing else — no response, no log.
 *
 * A token endpoint that refuses a refresh — an expired or revoked refresh
 * token — is `ERR_UNAUTHENTICATED`; a pool that cannot be reached or answers
 * anything else throws, and the request answers a bare 500.
 */
export function cognitoWebSession(options: CognitoWebSessionOptions): WebSession {
  const origins = new Set(options.webOrigins);
  const fromWebClient = (request: Request): boolean =>
    origins.has(request.headers.get("origin") ?? "");
  const cookie = (request: Request, name: string): string =>
    cookieValue(request.headers.get("cookie"), name) ?? "";

  return {
    signIn: async (request) => {
      if (!fromWebClient(request)) {
        return refused("ERR_FORBIDDEN");
      }
      const body = await readJsonBody(request);
      if (!body.ok) {
        return refused(body.error);
      }
      const credentials = credentialsOf(body.value);
      if (credentials === undefined) {
        return refused("ERR_BAD_REQUEST");
      }
      const issued = await signInWithPassword(
        options,
        credentials.email,
        credentials.password,
      );
      return issued.ok
        ? answer(
            withCookies(new Response(null, { status: 204 }), keep(issued.value)),
            "ok",
          )
        : refused(issued.error);
    },

    refreshSession: async (request) => {
      if (!fromWebClient(request)) {
        return refused("ERR_FORBIDDEN");
      }
      const refreshToken = cookie(request, REFRESH_COOKIE);
      if (refreshToken === "") {
        return refused("ERR_UNAUTHENTICATED");
      }
      const issued = await refreshTokens(options, refreshToken);
      return issued.ok
        ? answer(
            withCookies(new Response(null, { status: 204 }), keep(issued.value)),
            "ok",
          )
        : // An older tab's refused rotation must not clear cookies a newer success set.
          refused(issued.error);
    },

    signOut: async (request) => {
      if (!fromWebClient(request)) {
        return refused("ERR_FORBIDDEN");
      }
      const refreshToken = cookie(request, REFRESH_COOKIE);
      if (refreshToken !== "") {
        // Signing out must drop the cookies even when the pool cannot be
        // reached: the token then lives out its validity, but no browser holds it.
        await revokeToken(options, refreshToken).catch(() => undefined);
      }
      return answer(
        withCookies(
          new Response(null, { status: 303, headers: { location: SIGN_IN_PAGE } }),
          DROP_SESSION,
        ),
        "ok",
      );
    },
  };
}
