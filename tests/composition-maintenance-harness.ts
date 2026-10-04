import type { DayKey } from "@instant-composition/domain";
import {
  rebuildCompositionReadModel,
  type ApplicationDeps,
  type RequestContext,
} from "@instant-composition/application";

/** Runs the independent worker in fixtures before measuring a read-only query. */
export async function settleComposition(
  deps: ApplicationDeps,
  context: RequestContext,
  day?: DayKey,
): Promise<void> {
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) return;
  const system: RequestContext = {
    ...context,
    actor: {
      kind: "system",
      onBehalfOf: context.learner.id,
      job: "rebuild-projections",
    },
  };
  for (let step = 0; step < 1000; step += 1) {
    const result = await rebuildCompositionReadModel(deps, system, day);
    if (result.status === "ready") return;
  }
  throw new Error("The composition worker did not become ready.");
}
