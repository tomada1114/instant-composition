import { err, ok, type Result } from "@instant-composition/domain";

import type { ApplicationError } from "./errors";
import { committed } from "./execute";
import type { LearnerStore } from "./store";

/**
 * Initializes adoption for a pre-projection round, one bounded log page and
 * conditional checkpoint at a time. A failed page leaves the log and the last
 * checkpoint intact; another request resumes it before recording any answer.
 */
export async function initializeRoundAnswers(
  store: LearnerStore,
  roundId: string,
): Promise<Result<undefined, ApplicationError>> {
  let complete = false;
  while (!complete) {
    const initialized = await committed(store, async () => {
      const round = await store.round(roundId);
      if (round === undefined) return err({ code: "ERR_ROUND_NOT_FOUND" });
      const state = round.value.answerState;
      if (
        round.value.firstPass === 0 ||
        round.value.finishedAt !== null ||
        state?.complete === true
      ) {
        return ok({ value: true, writes: [] });
      }
      const page = await store.reviewPage(roundId, state?.cursor ?? null);
      const firstCards = [
        ...new Set([
          ...(state?.firstCards ?? []),
          ...page.entries
            .filter((entry) => entry.detail.pass === "first")
            .map((entry) => entry.item.id),
        ]),
      ].filter((id) => round.value.deck.includes(id));
      const answerState = {
        firstCards,
        cursor: page.cursor,
        complete: page.cursor === null,
      };
      return ok({
        value: answerState.complete,
        writes: [
          [{ type: "round" as const, value: { ...round.value, answerState } }, round],
        ] as const,
      });
    });
    if (!initialized.ok) return initialized;
    complete = initialized.value;
  }
  return ok(undefined);
}
