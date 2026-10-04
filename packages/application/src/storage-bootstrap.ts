import type { Result } from "@instant-composition/domain";
import type { Stored } from "./store";

/** Supplied only by the immutable storage guard's second handler context. */
export interface StorageBootstrapRelease {
  readonly sha: string;
  readonly contract: string;
  readonly schemaFingerprint: string;
}

/** Durable progress survives a fresh deployment job. Maintenance version binds
 * the pass diagnostically; each verification page still checks every learner's
 * current profile, source epoch and model identity, and its day/expiry window.
 */
export interface ReadModelBootstrapState {
  readonly schema: 1;
  readonly release: StorageBootstrapRelease;
  readonly catalog: string;
  readonly checkpoint: string | null;
  readonly validUntil: number | null;
  readonly maintenanceVersion: number | null;
  readonly complete: boolean;
  readonly phase: "discovery" | "preparation" | "verification";
  readonly rows: number;
  readonly learners: number;
}

/** System-only CAS port, separate from every learner-bound store. */
export interface ReadModelBootstrapStorage {
  checkpoint(): Promise<Stored<ReadModelBootstrapState> | undefined>;
  save(
    value: ReadModelBootstrapState,
    version: number | null,
  ): Promise<Result<undefined, { readonly code: "ERR_CONFLICT" }>>;
}
