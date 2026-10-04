import {
  rebuildVocabReadModel,
  type ApplicationDeps,
  type RequestContext,
} from "@instant-composition/application";
import { addDays, dayOf } from "@instant-composition/domain";

/** Explicit worker ticks for fixture setup; screen reads never invoke this. */
export async function prepareVocabReadModels(
  deps: ApplicationDeps,
  input: RequestContext,
): Promise<void> {
  const context: RequestContext = {
    ...input,
    actor: { kind: "system", job: "rebuild-projections", onBehalfOf: input.learner.id },
  };
  const today = dayOf(input.now, input.learner.timeZone, input.learner.dayBoundaryHour);
  for (const day of [today, addDays(today, 1)]) {
    for (let count = 0; count < 10_000; count += 1) {
      const result = await rebuildVocabReadModel(deps, context, day);
      if (!result.ok) throw new Error(result.error.code);
      if (result.value.status === "ready") break;
      if (count === 9_999) throw new Error("The maintenance fixture did not complete.");
    }
  }
}
