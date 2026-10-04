import type { ErrorCode } from "@instant-composition/contracts";

import { SESSION_COOKIE } from "./cognito-authenticator";
import { clearCookie, cookieValue, setCookie } from "./cookies";
import { failure } from "./http";
import { challengeOf, newSignIn, readSignIn, sameState, signInValue } from "./pkce";
import {
  exchangeCode,
  refreshTokens,
  revokeToken,
  type CognitoClient,
  type IssuedTokens,
} from "./token-endpoint";
import type { WebSession, WebSessionAnswer } from "./web-session";

/** The cookie the session's refresh token is kept in, beside {@link SESSION_COOKIE}. */
export const REFRESH_COOKIE = "__Host-refresh-token";

/** The cookie one sign-in keeps its `state` and PKCE verifier in, from login to callback. */
export const SIGN_IN_COOKIE = "__Host-sign-in";

/** How long a sign-in may take between leaving for the managed login and coming back. */
const SIGN_IN_SECONDS = 600;

/**
 * How long the browser keeps the refresh token: the web app client's refresh
 * token validity, Cognito's default of 30 days, which the foundation stack
 * leaves as it is. A cookie kept past its token only earns a refused refresh.
 */
const REFRESH_SECONDS = 30 * 24 * 60 * 60;

export interface CognitoWebSessionOptions extends CognitoClient {
  /** The web client's origins: `/refresh` and `/logout` refuse a request from any other. */
  readonly webOrigins: readonly string[];
  /** The callback URL registered on the app client, as the browser reaches `/v1/auth/callback`. */
  readonly callbackUrl: string;
  /** The sign-out URL registered on the app client, where the browser lands after `/logout`. */
  readonly signOutUrl: string;
}

/** An authorization code as the callback may carry one. */
const CODE = /^[\w.~+/=-]{1,1024}$/u;

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

function redirect(
  status: 302 | 303,
  location: string,
  cookies: readonly string[],
): Response {
  return withCookies(new Response(null, { status, headers: { location } }), cookies);
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
const DROP_SIGN_IN = [clearCookie(SIGN_IN_COOKIE)];

/**
 * The web session over a Cognito user pool's confidential app client: the
 * authorization code flow with PKCE (S256), the code redeemed with the client
 * secret the server alone holds, and the tokens set as `__Host-` cookies that
 * are HttpOnly, Secure and SameSite=Lax.
 *
 * @remarks
 * The callback is a top-level navigation from the managed login, which carries
 * no `Origin`; its CSRF check is the `state`, matched against the one this
 * browser's sign-in cookie holds. `/refresh` and `/logout` change state from a
 * page, so, as on the rest of the cookie path, a missing or foreign `Origin`
 * is `ERR_FORBIDDEN` before anything is read.
 *
 * A token endpoint that refuses the grant — a spent code, an expired or
 * revoked refresh token — is `ERR_UNAUTHENTICATED`; one that cannot be reached
 * or answers anything else throws, and the request answers a bare 500.
 */
export function cognitoWebSession(options: CognitoWebSessionOptions): WebSession {
  const origins = new Set(options.webOrigins);
  const fromWebClient = (request: Request): boolean =>
    origins.has(request.headers.get("origin") ?? "");
  const cookie = (request: Request, name: string): string =>
    cookieValue(request.headers.get("cookie"), name) ?? "";

  return {
    startSignIn: async () => {
      const secrets = newSignIn();
      const query = new URLSearchParams({
        response_type: "code",
        client_id: options.clientId,
        redirect_uri: options.callbackUrl,
        scope: "openid",
        state: secrets.state,
        code_challenge: await challengeOf(secrets.verifier),
        code_challenge_method: "S256",
      });
      const cookies = [
        setCookie(SIGN_IN_COOKIE, signInValue(secrets), SIGN_IN_SECONDS),
      ];
      return answer(
        redirect(
          302,
          `${options.domain}/oauth2/authorize?${query.toString()}`,
          cookies,
        ),
        "ok",
      );
    },

    finishSignIn: async (request) => {
      const params = new URL(request.url).searchParams;
      const started = readSignIn(cookie(request, SIGN_IN_COOKIE));
      if (
        started === undefined ||
        !sameState(params.get("state") ?? "", started.state)
      ) {
        return refused("ERR_FORBIDDEN", DROP_SIGN_IN);
      }
      const code = params.get("code") ?? "";
      if (!CODE.test(code)) {
        return refused("ERR_UNAUTHENTICATED", DROP_SIGN_IN);
      }
      const issued = await exchangeCode(
        options,
        code,
        started.verifier,
        options.callbackUrl,
      );
      return issued.ok
        ? answer(redirect(302, "/", [...DROP_SIGN_IN, ...keep(issued.value)]), "ok")
        : refused(issued.error, DROP_SIGN_IN);
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
      const query = new URLSearchParams({
        client_id: options.clientId,
        logout_uri: options.signOutUrl,
      });
      return answer(
        redirect(303, `${options.domain}/logout?${query.toString()}`, DROP_SESSION),
        "ok",
      );
    },
  };
}
