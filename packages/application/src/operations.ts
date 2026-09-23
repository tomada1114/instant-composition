import { err, ok, type Result } from "@instant-composition/domain";

import type { Actor, SystemJob } from "./context";
import type { ApplicationError } from "./errors";

/** Every command and query a learner may run on their own data. */
export const LEARNER_OPERATIONS = [
  "startRound",
  "recordAnswers",
  "finishRound",
  "updateSettings",
  "home",
  "records",
  "recap",
  "settings",
  "history",
] as const;

/** Operations only a system job runs. */
export const SYSTEM_OPERATIONS = ["rebuildProjections"] as const;

export type OperationKind =
  (typeof LEARNER_OPERATIONS)[number] | (typeof SYSTEM_OPERATIONS)[number];

/** The operations each system job may run: the one table a new job is added to. */
const JOB_OPERATIONS: Readonly<Record<SystemJob, readonly OperationKind[]>> = {
  "rebuild-projections": ["rebuildProjections"],
};

function isLearnerOperation(kind: OperationKind): boolean {
  return (LEARNER_OPERATIONS as readonly OperationKind[]).includes(kind);
}

/**
 * Whether `actor` may run `operation`: the one authorization decision. A
 * learner runs any learner operation; a system job only what its row allows; an
 * agent only what it was granted, and never more than the learner could.
 */
export function authorize(
  actor: Actor,
  operation: { readonly kind: OperationKind },
): Result<undefined, ApplicationError> {
  const allowed =
    actor.kind === "learner"
      ? isLearnerOperation(operation.kind)
      : actor.kind === "system"
        ? JOB_OPERATIONS[actor.job].includes(operation.kind)
        : actor.grants.includes(operation.kind) && isLearnerOperation(operation.kind);
  return allowed ? ok(undefined) : err({ code: "ERR_FORBIDDEN" });
}
