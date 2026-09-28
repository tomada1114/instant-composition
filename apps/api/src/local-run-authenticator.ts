import type { Authenticator } from "./authenticator";
import { cognitoAuthenticator } from "./cognito-authenticator";
import { cognitoWebSession } from "./cognito-web-session";
import type { CognitoSettings } from "./env-settings";
import { localAuthenticator } from "./local-authenticator";
import type { Fetch } from "./token-endpoint";
import type { WebSession } from "./web-session";

/**
 * The web client's origins on a local run: the Vite dev server and
 * `vite preview`, each bound to a fixed port on 127.0.0.1
 * (`apps/web/vite.config.ts`). Both proxy `/api` with the Host rewritten, so a
 * request's own origin is the API's, never the page's: the page's has to be
 * named.
 */
export const LOCAL_WEB_ORIGINS = ["http://127.0.0.1:5173", "http://127.0.0.1:4173"];

/**
 * Where the `dev` web app client sends a local run's browser back to, after
 * sign-in and after sign-out: the URLs registered on it in
 * `infra/src/foundation-stack.ts`, through the Vite dev server's `/api` proxy.
 */
export const LOCAL_SIGN_IN_URLS = {
  callbackUrl: "http://127.0.0.1:5173/api/v1/auth/callback",
  signOutUrl: "http://127.0.0.1:5173/",
} as const;

/** The authenticator a local run wires, and which one it is, for its start-up line. */
export interface LocalRunAuthenticator {
  readonly kind: "cognito" | "local";
  readonly authenticator: Authenticator;
}

/**
 * Cognito's verifier when a user pool is configured (`API_COGNITO_*`), and
 * the stand-in otherwise (ADR-0005's Local development).
 */
export function localRunAuthenticator(
  cognito: CognitoSettings | null,
): LocalRunAuthenticator {
  return cognito === null
    ? { kind: "local", authenticator: localAuthenticator() }
    : {
        kind: "cognito",
        authenticator: cognitoAuthenticator({
          userPoolId: cognito.userPoolId,
          clientId: cognito.clientId,
          webOrigins: LOCAL_WEB_ORIGINS,
        }),
      };
}

/**
 * The web sign-in endpoints a local run serves when a user pool is
 * configured, reaching its domain through `fetch`; none with the stand-in,
 * which has nobody to sign in.
 */
export function localRunWebSession(
  cognito: CognitoSettings | null,
  fetch: Fetch,
): WebSession | undefined {
  return cognito === null
    ? undefined
    : cognitoWebSession({
        clientId: cognito.clientId,
        clientSecret: cognito.clientSecret,
        domain: cognito.domain,
        fetch,
        webOrigins: LOCAL_WEB_ORIGINS,
        ...LOCAL_SIGN_IN_URLS,
      });
}
