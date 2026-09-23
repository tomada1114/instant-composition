import {
  addDays,
  decideStart,
  ok,
  type Portion,
  type Result,
  type StartCommand,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps, type Write } from "./execute";
import { loadPractice, statsOf } from "./practice";
import { payloadOf } from "./present";
import type { RoundPayload } from "./views";

/**
 * Starts a round of the command's kind, or resumes today's open round of that
 * kind. A retried start with the same round id hands back the round it made.
 */
export async function startRound(
  deps: ApplicationDeps,
  context: RequestContext,
  command: StartCommand,
): Promise<Result<RoundPayload, ApplicationError>> {
  const bound = storeFor(deps, context, "startRound");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed(store, async () => {
    const loaded = await loadPractice(store, deps.catalog, context);
    if (!loaded.ok) {
      return loaded;
    }
    const { practice, snapshot } = loaded.value;
    const stats = statsOf(loaded.value);
    const today = practice.today;
    const [existing, open, todayPortion, yesterdayPortion, tallies] = await Promise.all(
      [
        store.round(command.roundId),
        stats.openRound === null ? undefined : store.round(stats.openRound.id),
        store.portion(today),
        store.portion(addDays(today, -1)),
        store.days([today]),
      ],
    );
    const openReviews = open === undefined ? [] : await store.reviewsOf(open.value.id);
    const portions = new Map(
      [todayPortion, yesterdayPortion].flatMap((portion) =>
        portion === undefined ? [] : [[portion.value.day, portion] as const],
      ),
    );
    const tally = tallies.get(today);
    const decided = decideStart(
      {
        now: context.now,
        practice,
        hasSettings: loaded.value.settings !== undefined,
        stats,
        existing: existing?.value,
        open: open?.value,
        openAnswered: new Set(
          openReviews
            .filter((review) => review.detail.pass === "first")
            .map((review) => review.item.id),
        ),
        portions: new Map([...portions].map(([day, stored]) => [day, stored.value])),
        tally: tally?.value,
      },
      command,
    );
    if (!decided.ok) {
      return decided;
    }
    const change = decided.value;
    const writes: Write[] = [];
    if (change.created) {
      writes.push([{ type: "round", value: change.round }, undefined]);
      writes.push([{ type: "stats", value: change.stats }, loaded.value.stats]);
    }
    if (change.refitted) {
      writes.push([{ type: "round", value: change.round }, open]);
    }
    if (change.abandoned !== undefined) {
      writes.push([{ type: "round", value: change.abandoned }, open]);
    }
    if (change.portion !== undefined) {
      writes.push([
        { type: "portion", value: change.portion },
        portions.get(change.portion.day),
      ]);
    }
    if (change.tally !== undefined) {
      writes.push([{ type: "day", value: change.tally }, tally]);
    }
    const round = change.round;
    const portion: Portion | undefined =
      round.portionDay === null
        ? undefined
        : change.portion?.day === round.portionDay
          ? change.portion
          : (portions.get(round.portionDay)?.value ??
            (await store.portion(round.portionDay))?.value);
    const reviews = change.created
      ? []
      : round.id === open?.value.id
        ? openReviews
        : await store.reviewsOf(round.id);
    return ok({ value: payloadOf(round, reviews, portion, snapshot), writes });
  });
}
