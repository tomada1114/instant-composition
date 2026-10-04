import { ok, err } from "@instant-composition/domain";
import type {
  MaintenanceLearner,
  MaintenanceCheckpoint,
  ReadModelMaintenance,
  Stored,
} from "@instant-composition/application";

/** A checkpointed system directory fake; the worker still uses real learner stores and projection rules. */
export function maintenanceHarness(learners: readonly MaintenanceLearner[]): {
  readonly maintenance: ReadModelMaintenance;
  readonly scans: () => number;
} {
  let kept: Stored<MaintenanceCheckpoint> | undefined;
  let scans = 0;
  const maintenance: ReadModelMaintenance = {
    checkpoint: () => Promise.resolve(kept),
    profiles: () => {
      scans += 1;
      return Promise.resolve({ learners, cursor: null });
    },
    save: (value, version) => {
      if ((kept?.version ?? null) !== version)
        return Promise.resolve(err({ code: "ERR_CONFLICT" }));
      kept = { value, version: (version ?? 0) + 1 };
      return Promise.resolve(ok(undefined));
    },
  };
  return { maintenance, scans: () => scans };
}
