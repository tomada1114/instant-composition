import {
  advanceReadModelBootstrap,
  advanceStoredReadModelBootstrap,
  advanceReadModelMaintenance,
  vocabReadModelsReady,
  compositionReadModelsValidity,
  type RequestContext,
  type ApplicationDeps,
  type MaintenanceResult,
  type ReadModelMaintenance,
  type ReadModelBootstrapDriver,
  type ReadModelBootstrapResult,
  type ReadModelBootstrapStorage,
  type StorageBootstrapRelease,
} from "@instant-composition/application";

/** A fixed invocation budget; a retained checkpoint continues the next minute. */
export const READ_MODEL_WORKER_STEPS = 100;

export async function runReadModelWorker(
  deps: ApplicationDeps,
  maintenance: ReadModelMaintenance,
  now: number,
): Promise<MaintenanceResult> {
  let learners = 0;
  let rows = 0;
  for (let index = 0; index < READ_MODEL_WORKER_STEPS; index += 1) {
    const result = await advanceReadModelMaintenance(deps, maintenance, now);
    if (!result.ok) throw new Error(result.error.code);
    learners += result.value.learners;
    rows += result.value.rows;
    if (result.value.status === "idle") break;
  }
  return { status: rows === 0 ? "idle" : "advanced", learners, rows };
}

/** Trusted operator entry; callers must supply readiness for every released model slice. */
export async function runReadModelBootstrap(
  deps: ApplicationDeps,
  maintenance: ReadModelMaintenance,
  backfill: ReadModelBootstrapDriver["backfill"],
  now: number,
  checkpoint: string | null,
  ready: ReadModelBootstrapDriver["ready"],
): Promise<ReadModelBootstrapResult> {
  const result = await advanceReadModelBootstrap(
    deps,
    maintenance,
    {
      backfill,
      prepare: (at) => runReadModelWorker(deps, maintenance, at),
      ready,
    },
    now,
    checkpoint,
  );
  return {
    complete: result.complete,
    phase: result.phase,
    checkpoint: result.checkpoint,
    rows: result.rows,
    learners: result.learners,
  };
}

/** Production bootstrap uses this durable entry with release identity supplied by the immutable guard. */
export async function runStoredReadModelBootstrap(
  deps: ApplicationDeps,
  maintenance: ReadModelMaintenance,
  storage: ReadModelBootstrapStorage,
  context: { readonly storageRelease?: StorageBootstrapRelease },
  backfill: ReadModelBootstrapDriver["backfill"],
  now: number,
  checkpoint: string | null,
  ready: ReadModelBootstrapDriver["ready"],
): Promise<ReadModelBootstrapResult> {
  if (context.storageRelease === undefined)
    throw new TypeError("Bootstrap requires a trusted storage guard release context.");
  return advanceStoredReadModelBootstrap(
    deps,
    maintenance,
    {
      backfill,
      prepare: (at) => runReadModelWorker(deps, maintenance, at),
      ready,
    },
    storage,
    context.storageRelease,
    now,
    checkpoint,
  );
}

/** Every released slice and queued old-day request must be ready at this receipt. */
export async function readModelBootstrapValidity(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<number | undefined> {
  const [composition, vocab] = await Promise.all([
    compositionReadModelsValidity(deps, context),
    vocabReadModelsReady(deps, context),
  ]);
  return composition === undefined || vocab === undefined
    ? undefined
    : Math.min(composition, vocab);
}
