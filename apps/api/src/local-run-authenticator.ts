import type { Authenticator } from "./authenticator";
import { cognitoAuthenticator } from "./cognito-authenticator";
import type { CognitoSettings } from "./env";
import { localAuthenticator } from "./local-authenticator";

/**
 * The web client's origins on a local run: the Vite dev server and
 * `vite preview`, each bound to a fixed port on 127.0.0.1
 * (`apps/web/vite.config.ts`). Both proxy `/api` with the Host rewritten, so a
 * request's own origin is the API's, never the page's: the page's has to be
 * named.
 */
export const LOCAL_WEB_ORIGINS = ["http://127.0.0.1:5173", "http://127.0.0.1:4173"];

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
          ...cognito,
          webOrigins: LOCAL_WEB_ORIGINS,
        }),
      };
}
