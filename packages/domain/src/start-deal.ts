import { portionSize } from "./compose";
import { availableFor, deal, dealExtraDeck } from "./deck";
import type { PracticeError } from "./errors";
import { choosePlacement } from "./placement";
import type { Portion } from "./records";
import { err, ok, type Result } from "./result";
import type { StartState } from "./start";
import { TUNING } from "./tuning";
import type { DayKey, RoundKind } from "./types";

/**
 * How each kind of round is dealt, and the portion it opens or retargets: a
 * portion is today's queue under the daily limits, sized when it opens.
 */

export type Dealt = Result<
  {
    readonly deck: readonly string[];
    readonly portion?: Portion;
    readonly portionDay: DayKey | null;
    readonly kind: RoundKind;
  },
  PracticeError
>;

function newPortion(day: DayKey, target: number): Portion {
  return { day, target, progress: 0, completedAt: null, completedRound: null };
}

/** "One more 5": the cards past today's queue. */
export function dealExtra(state: StartState, seed: string): Dealt {
  const dealt = dealExtraDeck(state.practice, seed);
  return dealt.ok
    ? ok({ deck: dealt.value.cardIds, portionDay: null, kind: "extra" })
    : dealt;
}

export function dealPlacement(
  state: StartState,
  seed: string,
  completed: ReadonlySet<DayKey>,
): Dealt {
  const { practice } = state;
  const chosen = choosePlacement({
    cards: practice.cards,
    topics: practice.topics,
    exclude: practice.answeredToday,
    seen: new Set(practice.seen.keys()),
    seed,
  });
  if (!chosen.ok) {
    return err({ code: "ERR_NOT_ENOUGH_CARDS", available: chosen.error.available });
  }
  const today = practice.today;
  const existing = state.portions.get(today);
  if (completed.has(today) || (existing?.progress ?? 0) > 0) {
    return ok({ deck: chosen.value, portionDay: null, kind: "placement" });
  }
  // Placement answers take today's limits like any others; the portion holds them all.
  const target = Math.max(portionSize(practice, 0), chosen.value.length);
  return ok({
    deck: chosen.value,
    portion:
      existing === undefined ? newPortion(today, target) : { ...existing, target },
    portionDay: today,
    kind: "placement",
  });
}

export function dealPortion(
  state: StartState,
  kind: "today" | "yesterday",
  creditDay: DayKey,
  seed: (kind: RoundKind) => string,
): Dealt {
  const { practice } = state;
  const existing = state.portions.get(creditDay);
  const available = availableFor(practice);
  const portion = existing ?? newPortion(creditDay, portionSize(practice, 0));
  if (existing === undefined && portion.target < TUNING.minDeckSize) {
    return err({ code: "ERR_NOT_ENOUGH_CARDS", available });
  }
  const remaining = portion.target - portion.progress;
  if (remaining <= 0) {
    return dealExtra(state, seed("extra"));
  }
  const dealt = deal(practice, { size: remaining, seed: seed(kind) });
  if (!dealt.ok) {
    return dealt;
  }
  return ok({
    deck: dealt.value.cardIds,
    portionDay: creditDay,
    kind,
    ...(existing === undefined ? { portion } : {}),
  });
}
