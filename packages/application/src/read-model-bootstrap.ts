import { dayOf, TUNING } from "@instant-composition/domain";
import type { RequestContext } from "./context";
import type { ApplicationDeps } from "./execute";
import type { MaintenanceResult, ReadModelMaintenance } from "./read-model-maintenance";
import {
  bootstrapCheckpoint,
  type BootstrapPhase,
  type BootstrapCheckpoint,
} from "./read-model-bootstrap-state";

export interface ReadModelBootstrapResult {
  readonly complete: boolean;
  readonly phase: BootstrapPhase;
  readonly checkpoint: string | null;
  readonly rows: number;
  readonly learners: number;
}

export interface ReadModelBootstrapStep extends ReadModelBootstrapResult {
  readonly validUntil: number | null;
  readonly catalog: string;
}

export interface ReadModelBootstrapDriver {
  backfill(
    cursor: string | null,
  ): Promise<{ readonly cursor: string | null; readonly rows: number }>;
  prepare(now: number): Promise<MaintenanceResult>;
  /** All released model slices must verify ready; undefined asks maintenance to continue. */
  ready(context: RequestContext): Promise<number | undefined>;
}

function result(
  checkpoint: BootstrapCheckpoint,
  rows: number,
  learners: number,
  complete = false,
): ReadModelBootstrapStep {
  return {
    complete,
    validUntil: checkpoint.validUntil,
    catalog: checkpoint.catalog,
    phase: checkpoint.phase,
    checkpoint: complete ? null : JSON.stringify(checkpoint),
    rows,
    learners,
  };
}

/** Fixed binary search bounds a verified page's validity at its next local practice-day boundary. */
function boundaryAfter(context: RequestContext): number {
  const today = dayOf(context.now, context.learner.timeZone, TUNING.dayBoundaryHour);
  let low = context.now;
  let high = low + 2 * 86_400_000;
  for (let step = 0; step < 32; step += 1) {
    const midpoint = Math.floor((low + high) / 2);
    if (dayOf(midpoint, context.learner.timeZone, TUNING.dayBoundaryHour) === today)
      low = midpoint;
    else high = midpoint;
  }
  return high;
}

/** One deployment prerequisite invocation: legacy discovery, fixed worker budget, or one registry page. */
export async function advanceReadModelBootstrap(
  deps: ApplicationDeps,
  maintenance: ReadModelMaintenance,
  driver: ReadModelBootstrapDriver,
  now: number,
  opaqueCheckpoint: string | null,
): Promise<ReadModelBootstrapStep> {
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) throw new Error(snapshot.error.code);
  let checkpoint = bootstrapCheckpoint(opaqueCheckpoint, snapshot.value.version);
  if (checkpoint.phase === "discovery") {
    const page = await driver.backfill(checkpoint.cursor);
    checkpoint = {
      ...checkpoint,
      phase: page.cursor === null ? "preparation" : "discovery",
      cursor: page.cursor,
    };
    return result(checkpoint, page.rows, 0);
  }
  if (checkpoint.phase === "preparation") {
    const prepared = await driver.prepare(now);
    return result(
      { ...checkpoint, phase: "verification", cursor: null, validUntil: null },
      prepared.rows,
      prepared.learners,
    );
  }
  if (checkpoint.validUntil !== null && checkpoint.validUntil <= now)
    return result(
      { ...checkpoint, phase: "preparation", cursor: null, validUntil: null },
      0,
      0,
    );
  const page = await maintenance.profiles(checkpoint.cursor);
  let validUntil = checkpoint.validUntil;
  for (const learner of page.learners) {
    const store = deps.stores.forLearner(learner.id);
    const profile = await store.profile();
    if (profile === undefined) continue;
    const context: RequestContext = {
      actor: { kind: "system", job: "rebuild-projections", onBehalfOf: learner.id },
      learner: {
        ...profile.value,
        id: learner.id,
        dayBoundaryHour: TUNING.dayBoundaryHour,
      },
      now,
      requestId: "read-model-bootstrap",
    };
    const expires = await driver.ready(context);
    if (
      expires === undefined ||
      expires <= now ||
      (await store.profile())?.version !== profile.version
    )
      return result(
        { ...checkpoint, phase: "preparation", cursor: null, validUntil: null },
        0,
        page.learners.length,
      );
    validUntil = Math.min(validUntil ?? Infinity, expires, boundaryAfter(context));
  }
  const latestCatalog = await deps.catalog.snapshot();
  if (!latestCatalog.ok || latestCatalog.value.version !== checkpoint.catalog)
    return result(
      { ...checkpoint, phase: "preparation", cursor: null, validUntil: null },
      0,
      page.learners.length,
    );
  checkpoint = { ...checkpoint, cursor: page.cursor, validUntil };
  return result(checkpoint, 0, page.learners.length, page.cursor === null);
}
