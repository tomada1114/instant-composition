import { err, ok, timeZoneOf, type Result } from "@instant-composition/domain";

import type { Catalog } from "./catalog";
import type { LearnerProfile, Profile, ProfilePatch, RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps } from "./execute";

function profileOf({ timeZone, l1, target, uiLocale }: LearnerProfile): Profile {
  return { timeZone, l1, target, uiLocale };
}

function sameProfile(a: Profile, b: Profile): boolean {
  return (
    a.timeZone === b.timeZone &&
    a.l1 === b.l1 &&
    a.target === b.target &&
    a.uiLocale === b.uiLocale
  );
}

/**
 * The profile after `patch`. A time zone must be an IANA zone; a first or
 * target language must be the pair the catalog serves, which is read only
 * when the patch names one. The UI locale is the contract's to bound: the UI
 * catalogs are the clients', not the server's.
 */
async function decideProfile(
  catalog: Catalog,
  before: Profile,
  patch: ProfilePatch,
): Promise<Result<Profile, ApplicationError>> {
  const timeZone =
    patch.timeZone === undefined ? before.timeZone : timeZoneOf(patch.timeZone);
  if (timeZone === undefined) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  if (patch.l1 !== undefined || patch.target !== undefined) {
    const snapshot = await catalog.snapshot();
    if (!snapshot.ok) {
      return snapshot;
    }
    const served = snapshot.value;
    if (
      (patch.l1 ?? served.l1) !== served.l1 ||
      (patch.target ?? served.target) !== served.target
    ) {
      return err({ code: "ERR_BAD_REQUEST" });
    }
  }
  return ok({
    timeZone,
    l1: patch.l1 ?? before.l1,
    target: patch.target ?? before.target,
    uiLocale: patch.uiLocale ?? before.uiLocale,
  });
}

/** The learner's profile, as this request signed them in with it. */
export function profile(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<Profile, ApplicationError>> {
  const bound = storeFor(deps, context, "profile");
  return Promise.resolve(bound.ok ? ok(profileOf(context.learner)) : bound);
}

/**
 * Saves the profile fields `patch` sets, and answers the profile saved.
 *
 * @remarks
 * The profile is read from the learner-bound store and written back as a
 * conditional update at the version read, so of two changes racing, the
 * later one is decided again over the earlier one's result rather than
 * overwriting it. A patch that changes nothing writes nothing.
 */
export async function updateProfile(
  deps: ApplicationDeps,
  context: RequestContext,
  patch: ProfilePatch,
): Promise<Result<Profile, ApplicationError>> {
  const bound = storeFor(deps, context, "updateProfile");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed(store, async () => {
    const current = await store.profile();
    const before = current?.value ?? profileOf(context.learner);
    const decided = await decideProfile(deps.catalog, before, patch);
    if (!decided.ok) {
      return decided;
    }
    const unchanged = current !== undefined && sameProfile(before, decided.value);
    return ok({
      value: decided.value,
      writes: unchanged ? [] : [[{ type: "profile", value: decided.value }, current]],
    });
  });
}
