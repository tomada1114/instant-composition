import { readModelSchemaSupported } from "./read-model";
import type { ApplicationDeps } from "./execute";
import {
  advanceReadModelBootstrap,
  type ReadModelBootstrapDriver,
  type ReadModelBootstrapResult,
  type ReadModelBootstrapStep,
} from "./read-model-bootstrap";
import { bootstrapCheckpoint } from "./read-model-bootstrap-state";
import type { ReadModelMaintenance } from "./read-model-maintenance";
import type {
  ReadModelBootstrapStorage,
  StorageBootstrapRelease,
} from "./storage-bootstrap";

function sameRelease(a: StorageBootstrapRelease, b: StorageBootstrapRelease): boolean {
  return (
    a.sha === b.sha &&
    a.contract === b.contract &&
    a.schemaFingerprint === b.schemaFingerprint
  );
}

/** The guarded worker owns this durable cursor; an operator cursor alone never certifies skipped pages. */
export async function advanceStoredReadModelBootstrap(
  deps: ApplicationDeps,
  maintenance: ReadModelMaintenance,
  driver: ReadModelBootstrapDriver,
  storage: ReadModelBootstrapStorage,
  release: StorageBootstrapRelease,
  now: number,
  _callerCheckpoint: string | null,
): Promise<ReadModelBootstrapResult> {
  if (_callerCheckpoint !== null && _callerCheckpoint.length > 8192)
    throw new TypeError("The operator bootstrap cursor exceeds its bound.");
  const [catalog, stored] = await Promise.all([
    deps.catalog.snapshot(),
    storage.checkpoint(),
  ]);
  if (!catalog.ok) throw new Error(catalog.error.code);
  if (stored !== undefined && !readModelSchemaSupported(stored.value))
    throw new TypeError("Unsupported durable bootstrap schema.");
  let checkpoint: string | null = null;
  if (stored !== undefined && sameRelease(stored.value.release, release)) {
    const value = stored.value;
    if (value.complete) {
      // A cached completion is never a certificate for a fresh job's current source/day/profile.
      checkpoint = JSON.stringify({
        schema: 1,
        phase: "verification",
        catalog: value.catalog,
        cursor: null,
        validUntil: null,
      });
    } else {
      if (value.checkpoint === null)
        throw new TypeError("Incomplete bootstrap progress needs a checkpoint.");
      const raw: unknown = JSON.parse(value.checkpoint);
      if (
        typeof raw !== "object" ||
        raw === null ||
        !("catalog" in raw) ||
        raw.catalog !== value.catalog
      )
        throw new TypeError("Durable bootstrap catalog does not match its checkpoint.");
      const parsed = bootstrapCheckpoint(value.checkpoint, value.catalog);
      if (
        parsed.phase !== value.phase ||
        parsed.validUntil !== value.validUntil ||
        parsed.catalog !== value.catalog
      )
        throw new TypeError("Durable bootstrap binding does not match its checkpoint.");
      checkpoint = value.checkpoint;
    }
  }
  const advanced = await advanceReadModelBootstrap(
    deps,
    maintenance,
    driver,
    now,
    checkpoint,
  );
  const latest = await deps.catalog.snapshot();
  if (!latest.ok) throw new Error(latest.error.code);
  const continued =
    advanced.checkpoint === null
      ? undefined
      : bootstrapCheckpoint(advanced.checkpoint, advanced.catalog);
  const phase = continued?.phase === "discovery" ? "discovery" : "preparation";
  const current: ReadModelBootstrapStep =
    latest.value.version === advanced.catalog
      ? advanced
      : {
          complete: false,
          phase,
          validUntil: null,
          catalog: latest.value.version,
          checkpoint: JSON.stringify({
            schema: 1,
            phase,
            catalog: latest.value.version,
            cursor: phase === "discovery" ? (continued?.cursor ?? null) : null,
            validUntil: null,
          }),
          rows: advanced.rows,
          learners: advanced.learners,
        };
  const pass = await maintenance.checkpoint();
  const saved = await storage.save(
    {
      schema: 1,
      release,
      catalog: latest.value.version,
      checkpoint: current.checkpoint,
      validUntil: current.validUntil,
      maintenanceVersion: pass?.version ?? null,
      complete: current.complete,
      phase: current.phase,
      rows: current.rows,
      learners: current.learners,
    },
    stored?.version ?? null,
  );
  if (!saved.ok) throw new Error(saved.error.code);
  return {
    complete: current.complete,
    phase: current.phase,
    checkpoint: current.checkpoint,
    rows: current.rows,
    learners: current.learners,
  };
}
