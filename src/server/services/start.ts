import { addDays } from "../../core/day";
import { choosePlacement } from "../../core/placement";
import { err, ok, type Result } from "../../core/result";
import { isYesterdayRecoverable } from "../../core/streak";
import { TUNING } from "../../core/tuning";
import type { DayKey, RoundKind } from "../../core/types";
import type { RoundPayload } from "../../core/views";
import type { RoundRow } from "../db";
import { answeredIn, availableFor, deal, refitDeck, seedFor, toPayload } from "./deck";
import type { ServiceDeps, ServiceError } from "./deps";
import { portionProgress, readProgress, type Progress } from "./progress";

type Started = Result<RoundPayload, ServiceError>;

function resume(deps: ServiceDeps, progress: Progress, round: RoundRow): Started {
  const answered = answeredIn(deps, round);
  const deck = refitDeck(deps, progress, round, round.deck.length - answered.size);
  return ok(toPayload(deps, progress, { ...round, deck }));
}

function insert(
  deps: ServiceDeps,
  progress: Progress,
  kind: RoundKind,
  portionDay: DayKey | null,
  deck: readonly string[],
): Started {
  const round = {
    id: deps.newId(),
    kind,
    day: progress.today,
    portionDay,
    deck,
    startedAt: progress.now,
  };
  deps.store.insertRound(round);
  return ok(
    toPayload(deps, progress, {
      ...round,
      finishedAt: null,
      abandonedAt: null,
      summary: null,
    }),
  );
}

/** The portion for `creditDay`, created with its target on first use. */
function ensurePortion(
  deps: ServiceDeps,
  progress: Progress,
  creditDay: DayKey,
): Result<number, ServiceError> {
  const existing = deps.store.getPortion(creditDay);
  if (existing !== undefined) {
    return ok(existing.target);
  }
  const available = availableFor(progress);
  const target = Math.min(
    progress.settings?.dailySize ?? TUNING.defaultDailySize,
    available,
  );
  if (target < TUNING.minDeckSize) {
    return err({ code: "ERR_NOT_ENOUGH_CARDS", available });
  }
  deps.store.insertPortion(creditDay, target);
  return ok(target);
}

function startPlacement(deps: ServiceDeps, progress: Progress): Started {
  const chosen = choosePlacement({
    cards: progress.meta,
    topics: progress.settings?.topics ?? [],
    exclude: progress.answeredToday,
    seen: new Set(progress.states.keys()),
    seed: seedFor(deps, progress, "placement"),
  });
  if (!chosen.ok) {
    return err({ code: "ERR_NOT_ENOUGH_CARDS", available: chosen.error.available });
  }
  const today = progress.today;
  const untouched =
    !progress.completed.has(today) &&
    portionProgress(deps, progress.answers, today) === 0;
  if (untouched) {
    const existing = deps.store.getPortion(today);
    const target = Math.min(
      progress.settings?.dailySize ?? TUNING.defaultDailySize,
      Math.max(availableFor(progress), chosen.value.length),
    );
    if (existing === undefined) {
      deps.store.insertPortion(today, target);
    } else {
      deps.store.setPortionTarget(today, target);
    }
  }
  return insert(deps, progress, "placement", untouched ? today : null, chosen.value);
}

function startPortion(
  deps: ServiceDeps,
  progress: Progress,
  kind: "today" | "yesterday",
  creditDay: DayKey,
): Started {
  const target = ensurePortion(deps, progress, creditDay);
  if (!target.ok) {
    return target;
  }
  const remaining = target.value - portionProgress(deps, progress.answers, creditDay);
  if (remaining <= 0) {
    return startExtra(deps, progress);
  }
  const dealt = deal(progress, {
    size: remaining,
    seed: seedFor(deps, progress, kind),
  });
  return dealt.ok
    ? insert(deps, progress, kind, creditDay, dealt.value.cardIds)
    : dealt;
}

function startExtra(deps: ServiceDeps, progress: Progress): Started {
  const dealt = deal(progress, {
    size: progress.settings?.dailySize ?? TUNING.defaultDailySize,
    seed: seedFor(deps, progress, "extra"),
  });
  return dealt.ok ? insert(deps, progress, "extra", null, dealt.value.cardIds) : dealt;
}

/**
 * Starts a round of `kind`, or hands back today's open round of the same kind
 * so a reload (or a doubled request) resumes rather than restarts. An open
 * round of another kind is abandoned; its answers still count.
 */
export function startRound(deps: ServiceDeps, requested: RoundKind): Started {
  const progress = readProgress(deps);
  deps.store.abandonOpenRoundsBefore(progress.today, progress.now);
  if (progress.contentError) {
    return err({ code: "ERR_CONTENT_UNREADABLE" });
  }
  if (progress.settings === undefined) {
    return err({ code: "ERR_BAD_REQUEST" });
  }

  // Today's portion asked for once it is done is simply another round.
  const kind =
    requested === "today" && progress.completed.has(progress.today)
      ? "extra"
      : requested;
  const active = deps.store.activeRound(progress.today);
  if (active?.kind === kind) {
    return resume(deps, progress, active);
  }
  if (active !== undefined) {
    deps.store.abandonRound(active.id, progress.now);
  }

  const today = progress.today;
  switch (kind) {
    case "placement":
      return startPlacement(deps, progress);
    case "today":
      return startPortion(deps, progress, "today", today);
    case "yesterday":
      return isYesterdayRecoverable(progress.completed, today)
        ? startPortion(deps, progress, "yesterday", addDays(today, -1))
        : err({ code: "ERR_ROUND_CLOSED" });
    case "extra":
      return startExtra(deps, progress);
  }
}
