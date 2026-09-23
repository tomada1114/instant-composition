import { err, ok, type Result } from "@instant-composition/domain";

import { cardFacts } from "./catalog";
import { loadClose, planClose } from "./close-round";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps } from "./execute";
import { summaryOf } from "./present";
import { recordInto, type RecordAnswersCommand } from "./record-answers";
import type { RoundSummary } from "./views";

/**
 * Takes in the round's last answers, then closes it and keeps its summary. A
 * finished round answers with the summary it kept, so finishing twice is safe.
 */
export async function finishRound(
  deps: ApplicationDeps,
  context: RequestContext,
  command: RecordAnswersCommand,
): Promise<Result<RoundSummary, ApplicationError>> {
  const bound = storeFor(deps, context, "finishRound");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  const catalog = snapshot.value;
  const kept = async (): Promise<
    Result<RoundSummary, ApplicationError> | undefined
  > => {
    const round = await store.round(command.roundId);
    if (round === undefined) {
      return err({ code: "ERR_ROUND_NOT_FOUND" });
    }
    const { outcome } = round.value;
    return outcome === null ? undefined : ok(summaryOf(round.value, outcome, catalog));
  };
  const before = await kept();
  if (before !== undefined) {
    return before;
  }
  const recorded = await recordInto(store, cardFacts(catalog), context, command);
  if (!recorded.ok) {
    return recorded.error.code === "ERR_ROUND_CLOSED"
      ? ((await kept()) ?? recorded)
      : recorded;
  }
  return committed(store, async () => {
    const round = await store.round(command.roundId);
    if (round === undefined) {
      return err({ code: "ERR_ROUND_NOT_FOUND" });
    }
    if (round.value.outcome !== null) {
      return ok({
        value: summaryOf(round.value, round.value.outcome, catalog),
        writes: [],
      });
    }
    const [load, settings] = await Promise.all([
      loadClose(store, round),
      store.settings(),
    ]);
    const plan = planClose(load, catalog, settings?.value.topics ?? [], context.now);
    return ok({ value: plan.summary, writes: plan.writes });
  });
}
