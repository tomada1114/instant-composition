/**
 * One sign-in's `state` and PKCE verifier (RFC 7636), each made of 32 random
 * bytes, and the S256 challenge the managed login is sent.
 */
export interface SignInSecrets {
  readonly state: string;
  readonly verifier: string;
}

/** The two halves of a sign-in cookie, each 32 bytes base64url-encoded. */
const SIGN_IN_VALUE = /^([\w-]{43})\.([\w-]{43})$/u;

function randomText(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** A fresh `state` and verifier, from the platform's cryptographic random source. */
export function newSignIn(): SignInSecrets {
  return { state: randomText(), verifier: randomText() };
}

/** The value a sign-in cookie keeps `secrets` in. */
export function signInValue(secrets: SignInSecrets): string {
  return `${secrets.state}.${secrets.verifier}`;
}

/** The secrets a sign-in cookie's value holds, or `undefined` when it holds none. */
export function readSignIn(value: string): SignInSecrets | undefined {
  const match = SIGN_IN_VALUE.exec(value);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { state: match[1], verifier: match[2] };
}

/** RFC 7636's S256 challenge for `verifier`. */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return Buffer.from(digest).toString("base64url");
}

/** Whether a callback's `state` is the one expected, compared in time that does not depend on where they differ. */
export function sameState(given: string, expected: string): boolean {
  if (given.length !== expected.length) {
    return false;
  }
  let differs = 0;
  for (let index = 0; index < given.length; index += 1) {
    differs |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return differs === 0;
}
