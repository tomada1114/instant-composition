import { err, ok, TUNING, type Result } from "@instant-composition/domain";

import type { LearnerId, LearnerProfile, Profile } from "./context";
import type { CommitConflict } from "./store";

/** A learner as the identity context records them: the internal id and the stored profile. */
export interface Registration {
  readonly learnerId: LearnerId;
  readonly profile: Profile;
}

/**
 * The identity context's records: which learner an identity provider's
 * subject (Cognito's `sub`) is, and that learner's profile.
 *
 * @remarks
 * Separate from `LearnerStores` on purpose: it is consulted before any
 * learner is known, and its one input is the subject the authenticator
 * verified — no method takes a learner id, so nothing here can be pointed at
 * another learner's records.
 */
export interface LearnerDirectory {
  /** The learner `subject` registered as, with their profile; `undefined` before their first sign-in. */
  learnerOf(subject: string): Promise<Registration | undefined>;
  /**
   * Maps `subject` to `registration.learnerId` and writes that learner's
   * profile, both or neither. It holds only while `subject` maps to no one and
   * the learner has no profile yet, so of two first sign-ins racing, one
   * commits and the other answers `ERR_CONFLICT`.
   */
  register(
    subject: string,
    registration: Registration,
  ): Promise<Result<undefined, CommitConflict>>;
}

/** What {@link signIn} needs: the directory, and where a new learner's id comes from. */
export interface SignInDeps {
  readonly directory: LearnerDirectory;
  /** A fresh id, never issued before; the edge chooses the source, so no randomness hides here. */
  readonly newLearnerId: () => LearnerId;
}

/**
 * The profile a learner starts with: a Japanese speaker practising English in
 * Tokyo, the one pair the catalog is built for (`dist/catalog/en/ja.json`).
 */
export const DEFAULT_PROFILE: Profile = {
  timeZone: "Asia/Tokyo",
  l1: "ja",
  target: "en",
  uiLocale: "ja",
};

/** How often a first sign-in re-reads after its registration lost the race. */
const MAX_ATTEMPTS = 3;

function learnerProfileOf({ learnerId, profile }: Registration): LearnerProfile {
  return { ...profile, id: learnerId, dayBoundaryHour: TUNING.dayBoundaryHour };
}

/**
 * The learner `subject` signs in as, registered with {@link DEFAULT_PROFILE}
 * on their first sign-in.
 *
 * @remarks
 * Load, decide, commit: a subject already mapped is answered from its record;
 * otherwise a new learner is registered in one conditional commit. When that
 * commit loses to a concurrent first sign-in of the same subject, the
 * directory is read again and the winner's learner is answered, so racing
 * sign-ins all end as one `LearnerId`.
 */
export async function signIn(
  deps: SignInDeps,
  subject: string,
): Promise<Result<LearnerProfile, CommitConflict>> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const found = await deps.directory.learnerOf(subject);
    if (found !== undefined) {
      return ok(learnerProfileOf(found));
    }
    const registration = { learnerId: deps.newLearnerId(), profile: DEFAULT_PROFILE };
    const registered = await deps.directory.register(subject, registration);
    if (registered.ok) {
      return ok(learnerProfileOf(registration));
    }
  }
  return err({ code: "ERR_CONFLICT" });
}
