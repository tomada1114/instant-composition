import type { Authenticator, Principal } from "./authenticator";

/**
 * The one subject a local run serves. Its learner is registered on the first
 * request, like any first sign-in, and found by it on every one after.
 */
export const LOCAL_SUBJECT = "local";

/**
 * The stand-in authenticator: every request is the one local subject.
 *
 * @remarks
 * It authenticates nothing, so it is only ever wired by `main.ts`, the local
 * Node entry, which listens on the loopback interface alone and refuses to
 * start inside AWS (see `readApiEnv`). No hosted entry may use it; Phase 3
 * replaces it with the Cognito verifier behind the same `Authenticator` port.
 */
export function localAuthenticator(): Authenticator {
  const principal: Principal = { subject: LOCAL_SUBJECT };
  return { authenticate: () => Promise.resolve(principal) };
}
