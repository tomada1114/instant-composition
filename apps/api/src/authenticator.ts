/** Who a request comes from, as the identity provider names them. */
export interface Principal {
  /** The provider's own, verified id for the person (Cognito's `sub`); never a key of learner data. */
  readonly subject: string;
}

/**
 * The port identity enters through, once per request, before anything reads a
 * learner's data (ADR-0005). It says only who the caller is: the learner that
 * subject maps to, and their profile, come from the learner directory. Until
 * Phase 3 the only implementation is `localAuthenticator`; Cognito's verifier
 * replaces it there.
 */
export interface Authenticator {
  authenticate(request: Request): Promise<Principal>;
}
