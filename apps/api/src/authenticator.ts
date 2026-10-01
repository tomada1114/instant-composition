import type { Result } from "@instant-composition/domain";

/** Who a request comes from, as the identity provider names them. */
export interface Principal {
  /** The provider's own, verified id for the person (Cognito's `sub`); never a key of learner data. */
  readonly subject: string;
}

/**
 * Why a request was not let in: it carries no credential that verifies
 * (`ERR_UNAUTHENTICATED`), or it is a session-cookie request that would change
 * state from an origin other than the web client's (`ERR_FORBIDDEN`).
 */
export interface AuthFailure {
  readonly code: "ERR_UNAUTHENTICATED" | "ERR_FORBIDDEN";
}

/**
 * The port identity enters through, once per request, before anything reads a
 * learner's data. It says only who the caller is: the learner that
 * subject maps to, and their profile, come from the learner directory.
 * `cognitoAuthenticator` is the real one; `localAuthenticator` stands in for it
 * on a local run with no user pool configured.
 */
export interface Authenticator {
  authenticate(request: Request): Promise<Result<Principal, AuthFailure>>;
}
