import { learnerId, type LearnerProfile } from "@instant-composition/application";
import { TUNING } from "@instant-composition/domain";

import type { Authenticator, Identity } from "./authenticator";

/**
 * The one learner a local run serves when the environment names none. This
 * module is the only place in the API that names a learner: every other one
 * receives the learner in the `RequestContext` built from what this returns.
 */
const LOCAL_LEARNER = {
  id: "local-learner",
  timeZone: "Asia/Tokyo",
  /** The first language `dist/catalog/en/ja.json` is built for. */
  l1: "ja",
} as const;

/** What a local run may say about its learner; anything absent takes the default. */
export interface LocalLearnerOptions {
  readonly id: string | undefined;
  readonly timeZone: string | undefined;
}

/**
 * The stand-in authenticator: every request is the one local learner.
 *
 * @remarks
 * It authenticates nothing, so it is only ever wired by `main.ts`, the local
 * Node entry, which listens on the loopback interface alone and refuses to
 * start inside AWS (see `readApiEnv`). No hosted entry may use it; Phase 3
 * replaces it with the Cognito verifier behind the same `Authenticator` port.
 */
export function localAuthenticator(options: LocalLearnerOptions): Authenticator {
  const id = learnerId(options.id ?? LOCAL_LEARNER.id);
  const learner: LearnerProfile = {
    id,
    timeZone: options.timeZone ?? LOCAL_LEARNER.timeZone,
    dayBoundaryHour: TUNING.dayBoundaryHour,
    l1: LOCAL_LEARNER.l1,
  };
  const identity: Identity = { actor: { kind: "learner", learnerId: id }, learner };
  return { authenticate: () => Promise.resolve(identity) };
}
