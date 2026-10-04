import { err, ok, type Result } from "@instant-composition/domain";

import {
  field,
  jsonOf,
  TIMEOUT_MS,
  token,
  type CognitoClient,
  type IssuedTokens,
} from "./token-endpoint";

/** The confidential app client, and the user pool whose own API signs a password in. */
export interface PasswordClient extends CognitoClient {
  /** The pool's id, `<region>_<id>`: its region names the endpoint `InitiateAuth` is sent to. */
  readonly userPoolId: string;
}

/**
 * Why a password sign-in issued no session: the email and password do not
 * sign anybody in (`ERR_UNAUTHENTICATED`), or the account can sign in only
 * after an administrator acts on it — a temporary password, a reset the pool
 * demands, or any other challenge (`ERR_SIGN_IN_ACTION_REQUIRED`).
 */
export type SignInRefused = "ERR_UNAUTHENTICATED" | "ERR_SIGN_IN_ACTION_REQUIRED";

/**
 * The user pool answered `InitiateAuth` with something other than tokens, a
 * challenge or a refusal of the credentials: it could not be reached, it
 * throttled the call, the client does not allow the flow, or the answer does
 * not fit a cookie. It carries the HTTP status alone, never the body, which
 * can quote the username.
 */
export class InitiateAuthError extends Error {
  readonly code = "ERR_API_INITIATE_AUTH" as const;
  /** The status the pool answered, or `null` when its answer was not the shape expected. */
  readonly status: number | null;

  constructor(status: number | null) {
    super(
      status === null
        ? "The user pool answered InitiateAuth with a body that is not a token set."
        : `The user pool answered InitiateAuth with ${String(status)}.`,
    );
    this.name = "InitiateAuthError";
    this.status = status;
  }
}

/** The exceptions that say the email and password sign nobody in. */
const REFUSED = new Set(["NotAuthorizedException", "UserNotFoundException"]);

/** The exceptions that say the account needs an administrator before it signs in. */
const ACTION_REQUIRED = new Set([
  "PasswordResetRequiredException",
  "UserNotConfirmedException",
]);

/** The user pool API's endpoint for the pool's region. */
export function identityProviderUrl(userPoolId: string): string {
  const [region = ""] = userPoolId.split("_");
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

/**
 * The `SECRET_HASH` a confidential client proves itself with:
 * Base64(HMAC-SHA256(client secret, username + client id)).
 */
export async function secretHash(
  client: CognitoClient,
  username: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(client.clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${username}${client.clientId}`),
  );
  return Buffer.from(mac).toString("base64");
}

/** An exception's name, from `__type` as the JSON protocol writes it (`[namespace#]Name`). */
function exceptionOf(body: unknown): string {
  const type = field(body, "__type");
  return typeof type === "string" ? (type.split("#").at(-1) ?? "") : "";
}

function tokensOf(
  result: unknown,
): (IssuedTokens & { readonly refreshToken: string }) | undefined {
  const accessToken = token(field(result, "AccessToken"));
  const refreshToken = token(field(result, "RefreshToken"));
  const expiresIn = field(result, "ExpiresIn");
  return accessToken === undefined ||
    refreshToken === undefined ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0
    ? undefined
    : { accessToken, expiresIn, refreshToken };
}

/**
 * Signs `username` in with `password` through the pool's own API:
 * `InitiateAuth` with `USER_PASSWORD_AUTH`, the client proved by its
 * `SECRET_HASH`. The password goes to the pool and nowhere else.
 *
 * @remarks
 * A challenge — `NEW_PASSWORD_REQUIRED` for a temporary password, or any
 * other — is answered by no one here: it is `ERR_SIGN_IN_ACTION_REQUIRED`, and
 * its `Session` is dropped.
 *
 * @throws {@link InitiateAuthError} for any other answer; a `fetch` that fails
 * or times out rejects with its own error.
 */
export async function signInWithPassword(
  client: PasswordClient,
  username: string,
  password: string,
): Promise<Result<IssuedTokens & { readonly refreshToken: string }, SignInRefused>> {
  const response = await client.fetch(
    new Request(identityProviderUrl(client.userPoolId), {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: client.clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
          SECRET_HASH: await secretHash(client, username),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  const body = await jsonOf(response);
  if (response.status === 400) {
    const exception = exceptionOf(body);
    if (REFUSED.has(exception)) return err("ERR_UNAUTHENTICATED");
    if (ACTION_REQUIRED.has(exception)) return err("ERR_SIGN_IN_ACTION_REQUIRED");
  }
  if (response.status !== 200) {
    throw new InitiateAuthError(response.status);
  }
  const result = field(body, "AuthenticationResult");
  if (result === undefined && typeof field(body, "ChallengeName") === "string") {
    return err("ERR_SIGN_IN_ACTION_REQUIRED");
  }
  const tokens = tokensOf(result);
  if (tokens === undefined) {
    throw new InitiateAuthError(null);
  }
  return ok(tokens);
}
