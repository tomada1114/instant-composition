import { err, ok, type Result } from "@instant-composition/domain";

/** How the API reaches the user pool's domain: `fetch` on a run, a fake in a test. */
export type Fetch = (request: Request) => Promise<Response>;

/** The confidential app client the web session signs in through, and the domain serving it. */
export interface CognitoClient {
  readonly clientId: string;
  /** Held by the server alone; it goes to the token endpoint and nowhere else. */
  readonly clientSecret: string;
  /** The user pool domain's origin, e.g. `https://example.auth.ap-northeast-1.amazoncognito.com`. */
  readonly domain: string;
  readonly fetch: Fetch;
}

/** The tokens one call to the token endpoint issued, as far as the web session keeps them. */
export interface IssuedTokens {
  readonly accessToken: string;
  /** How many seconds the access token stays valid. */
  readonly expiresIn: number;
  /** A new refresh token, or `undefined` when the endpoint issued none and the old one stands. */
  readonly refreshToken: string | undefined;
}

/**
 * The user pool's domain answered something other than tokens or a refused
 * grant: it could not be reached, the client is misconfigured, or the answer
 * does not fit a cookie. It carries the HTTP status alone, never the body,
 * which can quote what was sent.
 */
export class TokenEndpointError extends Error {
  readonly code = "ERR_API_TOKEN_ENDPOINT" as const;
  /** The status the endpoint answered, or `null` when its answer was not the shape expected. */
  readonly status: number | null;

  constructor(status: number | null) {
    super(
      status === null
        ? "The user pool's token endpoint answered a body that is not a token set."
        : `The user pool's token endpoint answered ${String(status)}.`,
    );
    this.name = "TokenEndpointError";
    this.status = status;
  }
}

/** A grant the endpoint refused: the refresh token is spent, expired, revoked or not this client's. */
export type GrantRefused = "ERR_UNAUTHENTICATED";

/** How long a call to the user pool may take before the request fails. */
export const TIMEOUT_MS = 10_000;

/**
 * A token a cookie can carry: a browser keeps no more than about 4 KiB per
 * cookie, and the value may hold no separator, space or quote.
 */
const COOKIE_SAFE_TOKEN = /^[\w.~+/=-]{1,3800}$/u;

function post(
  client: CognitoClient,
  path: string,
  form: Readonly<Record<string, string>>,
): Promise<Response> {
  return client.fetch(
    new Request(`${client.domain}${path}`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
}

/** A response's JSON body, or `undefined` when it carries none. */
export async function jsonOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** The member `name` of a JSON object, or `undefined` for any other value. */
export function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? (body as Readonly<Record<string, unknown>>)[name]
    : undefined;
}

/** `value` when it is a token a cookie can carry, or `undefined`. */
export function token(value: unknown): string | undefined {
  return typeof value === "string" && COOKIE_SAFE_TOKEN.test(value) ? value : undefined;
}

/** Tokens, a refused grant, or a {@link TokenEndpointError} for anything else. */
async function grant(
  client: CognitoClient,
  form: Readonly<Record<string, string>>,
): Promise<Result<IssuedTokens, GrantRefused>> {
  const response = await post(client, "/oauth2/token", {
    ...form,
    client_id: client.clientId,
  });
  const body = await jsonOf(response);
  if (response.status === 400 && field(body, "error") === "invalid_grant") {
    return err("ERR_UNAUTHENTICATED");
  }
  if (response.status !== 200) {
    throw new TokenEndpointError(response.status);
  }
  const accessToken = token(field(body, "access_token"));
  const expiresIn = field(body, "expires_in");
  const refresh = field(body, "refresh_token");
  const refreshToken = token(refresh);
  if (
    accessToken === undefined ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    (refresh !== undefined && refreshToken === undefined)
  ) {
    throw new TokenEndpointError(null);
  }
  return ok({ accessToken, expiresIn, refreshToken });
}

/**
 * Renews a session through `/oauth2/token`'s `refresh_token` grant. With
 * refresh-token rotation on, the answer carries a new refresh token that
 * replaces the one sent.
 */
export function refreshTokens(
  client: CognitoClient,
  refreshToken: string,
): Promise<Result<IssuedTokens, GrantRefused>> {
  return grant(client, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Revokes a refresh token, and the access tokens issued from it, through `/oauth2/revoke`. */
export async function revokeToken(
  client: CognitoClient,
  refreshToken: string,
): Promise<void> {
  const response = await post(client, "/oauth2/revoke", {
    token: refreshToken,
    client_id: client.clientId,
  });
  await response.body?.cancel();
  if (response.status !== 200) {
    throw new TokenEndpointError(response.status);
  }
}
