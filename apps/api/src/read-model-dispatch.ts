import type {
  ApplicationDeps,
  ReadModelMaintenance,
  ReadModelBootstrapStorage,
  ReadModelBootstrapDriver,
  MaintenanceResult,
  ReadModelBootstrapResult,
  StorageBootstrapRelease,
} from "@instant-composition/application";
import { runReadModelWorker, runStoredReadModelBootstrap } from "./read-model-runner";

export interface ReadModelWorkerRuntime {
  readonly deps: ApplicationDeps;
  readonly maintenance: ReadModelMaintenance;
  readonly storage: ReadModelBootstrapStorage;
  readonly backfill: ReadModelBootstrapDriver["backfill"];
  readonly ready: ReadModelBootstrapDriver["ready"];
  readonly now: number;
  close(): void;
}
function bootstrapEvent(
  event: unknown,
): { readonly checkpoint: string | null } | undefined {
  if (
    typeof event !== "object" ||
    event === null ||
    !("storageBootstrap" in event) ||
    event.storageBootstrap !== true
  )
    return undefined;
  if (
    !("checkpoint" in event) ||
    (event.checkpoint !== null &&
      (typeof event.checkpoint !== "string" || event.checkpoint.length > 8192)) ||
    Object.keys(event).some((key) => key !== "storageBootstrap" && key !== "checkpoint")
  )
    throw new TypeError("The storage bootstrap event is unsupported.");
  return { checkpoint: event.checkpoint };
}
function trustedRelease(context: unknown): StorageBootstrapRelease {
  const release =
    typeof context === "object" && context !== null
      ? (Reflect.get(context, "storageRelease") as unknown)
      : undefined;
  if (
    typeof release !== "object" ||
    release === null ||
    Object.keys(release).sort().join(",") !== "contract,schemaFingerprint,sha" ||
    !("sha" in release) ||
    typeof release.sha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(release.sha) ||
    !("contract" in release) ||
    typeof release.contract !== "string" ||
    release.contract.length === 0 ||
    !("schemaFingerprint" in release) ||
    typeof release.schemaFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(release.schemaFingerprint)
  )
    throw new TypeError("Bootstrap requires a trusted storage guard release context.");
  return {
    sha: release.sha,
    contract: release.contract,
    schemaFingerprint: release.schemaFingerprint,
  };
}
/** The real hosted branch validates immutable guard context before creating runtime I/O. */
export function createReadModelWorkerHandler(
  createRuntime: () => ReadModelWorkerRuntime,
): (
  event?: unknown,
  context?: unknown,
) => Promise<MaintenanceResult | ReadModelBootstrapResult> {
  return async (event?: unknown, context?: unknown) => {
    const bootstrap = bootstrapEvent(event);
    const storageRelease =
      bootstrap === undefined ? undefined : trustedRelease(context);
    const runtime = createRuntime();
    try {
      return bootstrap === undefined
        ? await runReadModelWorker(runtime.deps, runtime.maintenance, runtime.now)
        : await runStoredReadModelBootstrap(
            runtime.deps,
            runtime.maintenance,
            runtime.storage,
            storageRelease === undefined ? {} : { storageRelease },
            runtime.backfill,
            runtime.now,
            bootstrap.checkpoint,
            runtime.ready,
          );
    } finally {
      runtime.close();
    }
  };
}
