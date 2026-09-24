import type { Actor, LearnerProfile } from "@instant-composition/application";

/** Who a request acts as, and the learner whose data it reaches. */
export interface Identity {
  readonly actor: Actor;
  readonly learner: LearnerProfile;
}

/**
 * The port identity enters through, once per request, before anything reads a
 * learner's data (ADR-0005). Until Phase 3 the only implementation is
 * `localAuthenticator`; Cognito's verifier replaces it there.
 */
export interface Authenticator {
  authenticate(request: Request): Promise<Identity>;
}
