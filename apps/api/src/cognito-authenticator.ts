import { err, ok, type Result } from "@instant-composition/domain";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { FetchError, JwtBaseError } from "aws-jwt-verify/error";
import { SimpleJwksCache, type Jwks } from "aws-jwt-verify/jwk";

import type { AuthFailure, Authenticator, Principal } from "./authenticator";
import { cookieValue } from "./cookies";

/**
 * The cookie the web session carries its access token in. The
 * `__Host-` prefix makes a browser accept it only when set `Secure`, with
 * `Path=/` and no `Domain`, so no sibling host can plant one; the endpoints
 * that set it use this same name.
 */
export const SESSION_COOKIE = "__Host-access-token";

export interface CognitoAuthenticatorOptions {
  /** The user pool whose access tokens are accepted, e.g. `ap-northeast-1_AbC123`. */
  readonly userPoolId: string;
  /** The app client an access token must have been issued to (its `client_id` claim). */
  readonly clientId: string;
  /**
   * The web client's origins: a session-cookie request that changes state is
   * let in only when its `Origin` header is one of these.
   */
  readonly webOrigins: readonly string[];
  /**
   * The pool's key set, when it is already known. Given one, the verifier
   * uses it alone and never fetches the pool's JWKS — which is how a test
   * verifies tokens it signed with a locally generated key.
   */
  readonly keySet?: Jwks;
}

/** Methods a session cookie may carry without an `Origin` check: they change nothing. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const UNAUTHENTICATED = err<AuthFailure>({ code: "ERR_UNAUTHENTICATED" });
const FORBIDDEN = err<AuthFailure>({ code: "ERR_FORBIDDEN" });

/** RFC 6750's `Bearer <b64token>`, the scheme matched case-insensitively. */
const BEARER = /^Bearer +([\w.~+/-]+=*) *$/iu;

/** A key set that answers any fetch with itself, so an unknown key id is refused, not fetched. */
function fixedJwksCache(keySet: Jwks): SimpleJwksCache {
  const body = new TextEncoder().encode(JSON.stringify(keySet));
  return new SimpleJwksCache({
    fetcher: { fetch: () => Promise.resolve(body.slice().buffer) },
  });
}

/**
 * The hosted authenticator: a Cognito access token, carried either
 * as `Authorization: Bearer <token>` (native clients) or in
 * {@link SESSION_COOKIE} (the web client), verified with `aws-jwt-verify`
 * against the pool's key set, `token_use` `access` and the expected client
 * id. Either carrier yields the same principal, the token's `sub`.
 *
 * @remarks
 * A request carrying an `Authorization` header is judged by it alone: the
 * Bearer path never reads a cookie, so a malformed header is refused rather
 * than falling back to one. The cookie path checks `Origin` on every
 * state-changing request, as CSRF protection alongside `SameSite=Lax`; a
 * Bearer request carries no ambient credential and needs no such check.
 *
 * A token that does not verify — malformed, expired, signed by another key,
 * issued by another pool, to another client or as an id token — is
 * `ERR_UNAUTHENTICATED`. A failure to fetch the pool's key set is not the
 * caller's fault, so it throws and the request answers a bare 500.
 */
export function cognitoAuthenticator(
  options: CognitoAuthenticatorOptions,
): Authenticator {
  const { keySet } = options;
  const properties = {
    userPoolId: options.userPoolId,
    clientId: options.clientId,
    tokenUse: "access",
  } as const;
  const verifier =
    keySet === undefined
      ? CognitoJwtVerifier.create(properties)
      : CognitoJwtVerifier.create(properties, { jwksCache: fixedJwksCache(keySet) });
  if (keySet !== undefined) {
    verifier.cacheJwks(keySet);
  }
  const origins = new Set(options.webOrigins);

  async function principalOf(token: string): Promise<Result<Principal, AuthFailure>> {
    try {
      const { sub } = await verifier.verify(token);
      return typeof sub === "string" && sub !== ""
        ? ok({ subject: sub })
        : UNAUTHENTICATED;
    } catch (error) {
      if (error instanceof JwtBaseError && !(error instanceof FetchError)) {
        return UNAUTHENTICATED;
      }
      throw error;
    }
  }

  return {
    authenticate: async (request) => {
      const authorization = request.headers.get("authorization");
      if (authorization !== null) {
        const token = BEARER.exec(authorization)?.[1];
        return token === undefined ? UNAUTHENTICATED : principalOf(token);
      }
      const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
      if (token === undefined || token === "") {
        return UNAUTHENTICATED;
      }
      if (
        !SAFE_METHODS.has(request.method) &&
        !origins.has(request.headers.get("origin") ?? "")
      ) {
        return FORBIDDEN;
      }
      return principalOf(token);
    },
  };
}
