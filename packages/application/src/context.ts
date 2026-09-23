import { err, ok, type Result } from "@instant-composition/domain";

import type { ApplicationError } from "./errors";
import type { OperationKind } from "./operations";

/** The internal id every learner-bound key carries; never an identity provider's own id. */
export type LearnerId = string & { readonly __brand: "LearnerId" };

export function learnerId(value: string): LearnerId {
  if (value === "") {
    throw new RangeError("A learner id is never empty.");
  }
  return value as LearnerId;
}

/** A job the system runs for one learner, carrying that learner from its own record. */
export type SystemJob = "rebuild-projections";

/** Who is acting. A system or agent actor is never broader than the learner it serves. */
export type Actor =
  | { readonly kind: "learner"; readonly learnerId: LearnerId }
  | { readonly kind: "system"; readonly job: SystemJob; readonly onBehalfOf: LearnerId }
  | {
      readonly kind: "agent";
      readonly onBehalfOf: LearnerId;
      readonly grants: readonly OperationKind[];
    };

export interface LearnerProfile {
  readonly id: LearnerId;
  /** An IANA time zone, such as `Asia/Tokyo`: every practice day is derived in it. */
  readonly timeZone: string;
  readonly dayBoundaryHour: number;
  /** The learner's first language, such as `ja`. */
  readonly l1: string;
}

/** Built once per request by the edge; nothing below it re-derives identity. */
export interface RequestContext {
  readonly actor: Actor;
  readonly learner: LearnerProfile;
  readonly now: number;
  readonly requestId: string;
}

function servedLearner(actor: Actor): LearnerId {
  return actor.kind === "learner" ? actor.learnerId : actor.onBehalfOf;
}

/** The context for `learner`, refused when the actor acts for someone else. */
export function requestContext(
  input: RequestContext,
): Result<RequestContext, ApplicationError> {
  return servedLearner(input.actor) === input.learner.id
    ? ok(input)
    : err({ code: "ERR_FORBIDDEN" });
}
