import { addDays, dayOf, ok, TUNING, type Result } from "@instant-composition/domain";

import type { LearnerId, Profile, RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import type { ApplicationDeps } from "./execute";
import { rebuildVocabReadModel } from "./rebuild-read-model";
import { rebuildCompositionReadModel } from "./composition-maintenance";
import { advanceRequestedVocabDay } from "./requested-vocab-day";
import { readModelSchemaSupported } from "./read-model";
import type { Stored } from "./store";

export interface MaintenanceLearner {
  readonly id: LearnerId;
  readonly profile: Profile;
}

export interface MaintenanceCheckpoint {
  readonly schema: 1;
  readonly cursor: string | null;
  readonly pending: readonly MaintenanceLearner[];
  readonly index: number;
  readonly passCompletedAt: number | null;
}

/** Cross-learner access exists only for the independently scheduled maintenance job. */
export interface ReadModelMaintenance {
  checkpoint(): Promise<Stored<MaintenanceCheckpoint> | undefined>;
  profiles(cursor: string | null): Promise<{
    readonly learners: readonly MaintenanceLearner[];
    readonly cursor: string | null;
  }>;
  save(
    value: MaintenanceCheckpoint,
    version: number | null,
  ): Promise<Result<undefined, { readonly code: "ERR_CONFLICT" }>>;
}

export interface MaintenanceResult {
  readonly status: "advanced" | "idle";
  readonly learners: number;
  readonly rows: number;
}

/** Advances one learner by fixed pages, retaining the scan and build checkpoints across invocations. */
export async function advanceReadModelMaintenance(
  deps: ApplicationDeps,
  maintenance: ReadModelMaintenance,
  now: number,
): Promise<Result<MaintenanceResult, ApplicationError>> {
  const previous = await maintenance.checkpoint();
  let checkpoint: MaintenanceCheckpoint = previous?.value ?? {
    schema: 1,
    cursor: null,
    pending: [],
    index: 0,
    passCompletedAt: null,
  };
  if (!readModelSchemaSupported(checkpoint))
    throw new TypeError("Unsupported read-model maintenance schema.");
  if (checkpoint.index >= checkpoint.pending.length) {
    if (
      checkpoint.cursor === null &&
      checkpoint.passCompletedAt !== null &&
      now - checkpoint.passCompletedAt < 60_000
    )
      return ok({ status: "idle", learners: 0, rows: 0 });
    const page = await maintenance.profiles(checkpoint.cursor);
    checkpoint = {
      ...checkpoint,
      cursor: page.cursor,
      pending: page.learners,
      index: 0,
    };
  }
  let learner = checkpoint.pending[checkpoint.index];
  const currentProfile =
    learner === undefined
      ? undefined
      : await deps.stores.forLearner(learner.id).profile();
  if (currentProfile === undefined) learner = undefined;
  let rows = 0;
  let completed = learner === undefined;
  if (learner !== undefined) {
    const profile = currentProfile?.value ?? learner.profile;
    const context: RequestContext = {
      actor: { kind: "system", job: "rebuild-projections", onBehalfOf: learner.id },
      learner: {
        ...profile,
        id: learner.id,
        dayBoundaryHour: TUNING.dayBoundaryHour,
      },
      now,
      requestId: "read-model-maintenance",
    };
    const today = dayOf(now, profile.timeZone, TUNING.dayBoundaryHour);
    for (const day of [today, addDays(today, 1)]) {
      const composition = await rebuildCompositionReadModel(deps, context, day);
      rows += composition.rows;
      if (composition.status !== "ready") break;
      const step = await rebuildVocabReadModel(deps, context, day);
      if (!step.ok) return step;
      rows += step.value.rows;
      if (step.value.status !== "ready") break;
      completed = day !== today;
    }
    if (completed) {
      const requested = await advanceRequestedVocabDay(deps, context);
      if (!requested.ok) return requested;
      rows += requested.value.rows;
      completed = requested.value.complete;
    }
  }
  if (completed) checkpoint = { ...checkpoint, index: checkpoint.index + 1 };
  const finished =
    checkpoint.index >= checkpoint.pending.length && checkpoint.cursor === null;
  checkpoint = {
    ...checkpoint,
    passCompletedAt: finished ? now : checkpoint.passCompletedAt,
  };
  const saved = await maintenance.save(checkpoint, previous?.version ?? null);
  return saved.ok
    ? ok({ status: "advanced", learners: Number(learner !== undefined), rows })
    : saved;
}
