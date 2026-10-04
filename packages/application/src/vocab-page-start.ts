import { type Result } from "@instant-composition/domain";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps } from "./execute";
import { ok } from "@instant-composition/domain";
import { planPagedVocab } from "./vocab-page-plan";
import { preparationOf, type VocabPreparation } from "./vocab-page-views";
import type { StartVocabSessionCommand } from "./vocab-session";

export async function startPagedVocabSession(
  deps: ApplicationDeps,
  context: RequestContext,
  command: StartVocabSessionCommand,
): Promise<Result<VocabPreparation, ApplicationError>> {
  const bound = storeFor(deps, context, "startVocabSession");
  if (!bound.ok) return bound;
  const store = bound.value;
  return committed(store, async () => {
    const existing = await store.vocabPagedSession(command.sessionId);
    if (existing !== undefined)
      return ok({ value: preparationOf(existing.value), writes: [] });
    const plan = await planPagedVocab(store, deps, context, command);
    return plan.ok
      ? ok({
          value: preparationOf(plan.value.session),
          writes: [
            [{ type: "vocabPagedSession", value: plan.value.session }, undefined],
          ],
          expect: plan.value.expect,
        })
      : plan;
  });
}
