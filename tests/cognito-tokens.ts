import {
  createSign,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from "node:crypto";

import type { CognitoAuthenticatorOptions } from "@instant-composition/api";

// Cognito access tokens signed with a key generated here, and the key set that
// verifies them: the real verifier runs, and nothing asks Cognito for its keys.

export const USER_POOL_ID = "ap-northeast-1_TestPool1";
export const CLIENT_ID = "testclient1";
/** The issuer Cognito writes into `USER_POOL_ID`'s tokens. */
export const ISSUER = `https://cognito-idp.ap-northeast-1.amazonaws.com/${USER_POOL_ID}`;

type KeySet = NonNullable<CognitoAuthenticatorOptions["keySet"]>;

export interface SigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly publicJwk: KeySet["keys"][number];
}

/** A fresh RS256 key pair, published under `kid`. */
export function signingKey(kid: string): SigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { n, e } = publicKey.export({ format: "jwk" });
  if (n === undefined || e === undefined)
    throw new Error("The key exported no modulus.");
  return {
    kid,
    privateKey,
    publicJwk: { kty: "RSA", alg: "RS256", use: "sig", kid, n, e },
  };
}

export function keySetOf(...keys: SigningKey[]): KeySet {
  return { keys: keys.map((key) => key.publicJwk) };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * An access token for `subject`, shaped as Cognito issues one to `CLIENT_ID`
 * and valid for the next hour; `claims` override any of its claims.
 */
export function accessToken(
  key: SigningKey,
  subject: string,
  claims: Readonly<Record<string, unknown>> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: subject,
    iss: ISSUER,
    client_id: CLIENT_ID,
    token_use: "access",
    scope: "openid email",
    auth_time: now,
    iat: now,
    exp: now + 3600,
    jti: randomUUID(),
    username: subject,
    ...claims,
  };
  const input = `${base64url({ alg: "RS256", kid: key.kid })}.${base64url(payload)}`;
  const signature = createSign("RSA-SHA256").update(input).sign(key.privateKey);
  return `${input}.${signature.toString("base64url")}`;
}
