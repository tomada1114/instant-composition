import {
  decideLevel,
  EMPTY_STATS,
  ok,
  type LevelChoice,
  type Result,
} from "@instant-composition/domain";

import { snapshotOrEmpty } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps, type Write } from "./execute";
import { levelViewOf } from "./present";
import type { LevelView } from "./views";

/**
 * Hands the level to the answers, or fixes it where the learner picks: a
 * picked level is dealt as it is and no round's answers move it. Only the
 * learner's totals are written; the settings are a commit of their own.
 */
export async function updateLevel(
  deps: ApplicationDeps,
  context: RequestContext,
  choice: LevelChoice,
): Promise<Result<LevelView, ApplicationError>> {
  const bound = storeFor(deps, context, "updateLevel");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed<LevelView>(store, async () => {
    const [stored, { snapshot }] = await Promise.all([
      store.stats(),
      snapshotOrEmpty(deps.catalog),
    ]);
    const stats = stored?.value ?? EMPTY_STATS;
    if (stored !== undefined && stats.streak === undefined)
      return { ok: false, error: { code: "ERR_READ_MODEL_NOT_READY" } };
    const decided = decideLevel(stats, choice, context.now);
    if (!decided.ok) {
      return decided;
    }
    const writes: Write[] =
      decided.value === stats
        ? []
        : [[{ type: "stats", value: decided.value }, stored]];
    return ok({ value: levelViewOf(decided.value, snapshot), writes });
  });
}
