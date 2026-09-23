import { addDays } from "./day";
import { longestRun, streakStatus, type CompletedDays } from "./streak";
import { TUNING } from "./tuning";
import type { DayKey, RoundKind } from "./types";

export interface PortionProgress {
  readonly target: number;
  /** First-pass answers given toward the portion. */
  readonly progress: number;
}

export interface ActiveRound {
  readonly kind: RoundKind;
  readonly portionDay: DayKey | null;
}

export interface HomeInput {
  readonly hasSettings: boolean;
  readonly hasLevel: boolean;
  readonly today: DayKey;
  readonly completed: CompletedDays;
  /** Keyed by credit day; today's and yesterday's are the ones read. */
  readonly portions: ReadonlyMap<DayKey, PortionProgress>;
  /** A round started today, neither finished nor abandoned. */
  readonly activeRound: ActiveRound | undefined;
  /** How many cards today's portion could be dealt from. */
  readonly available: number;
}

/** The number above the week: a run to show, or "day 1 from today" instead of a 0. */
export type StreakView =
  | { readonly kind: "count"; readonly value: number; readonly yesterdayGap: boolean }
  | { readonly kind: "restart"; readonly longest: number };

export type HomeState =
  | { readonly kind: "onboarding" }
  | { readonly kind: "placement" }
  | { readonly kind: "ready"; readonly streak: StreakView }
  | { readonly kind: "recover-offer"; readonly streak: StreakView }
  | {
      readonly kind: "in-progress";
      readonly portion: "today" | "yesterday";
      readonly progress: number;
      readonly target: number;
      readonly resumeKind: RoundKind;
      readonly streak: StreakView;
    }
  | {
      readonly kind: "done";
      readonly restoresTo: number | null;
      readonly streak: StreakView;
    }
  | {
      readonly kind: "not-enough";
      readonly available: number;
      readonly streak: StreakView;
    };

/** A portion under way; yesterday's only counts while it can still be made up. */
function inProgress(
  input: HomeInput,
  streak: StreakView,
  yesterdayOpen: boolean,
): HomeState | undefined {
  const yesterday = addDays(input.today, -1);
  const partial = (day: DayKey): PortionProgress | undefined => {
    const portion = input.portions.get(day);
    return portion !== undefined && !input.completed.has(day) ? portion : undefined;
  };
  const active = input.activeRound;
  const portionDay =
    active?.portionDay ??
    (yesterdayOpen ? [input.today, yesterday] : [input.today]).find(
      (day) => (partial(day)?.progress ?? 0) > 0,
    );
  const portion = portionDay === undefined ? undefined : partial(portionDay);
  if (portionDay === undefined || portion === undefined) {
    return undefined;
  }
  const isToday = portionDay === input.today;
  return {
    kind: "in-progress",
    portion: isToday ? "today" : "yesterday",
    progress: portion.progress,
    target: portion.target,
    resumeKind:
      active?.portionDay === portionDay ? active.kind : isToday ? "today" : "yesterday",
    streak,
  };
}

export function homeState(input: HomeInput): HomeState {
  if (!input.hasSettings) {
    return { kind: "onboarding" };
  }
  if (!input.hasLevel) {
    return { kind: "placement" };
  }

  const status = streakStatus(input.completed, input.today);
  switch (status.kind) {
    case "done":
      return {
        kind: "done",
        restoresTo: status.restoresTo,
        streak: {
          kind: "count",
          value: status.current,
          yesterdayGap: status.restoresTo !== null,
        },
      };
    case "gap": {
      const gapView: StreakView = {
        kind: "count",
        value: status.current,
        yesterdayGap: true,
      };
      const resumed = inProgress(input, gapView, true);
      if (resumed?.kind === "in-progress" && resumed.portion === "today") {
        return {
          ...resumed,
          streak: { kind: "restart", longest: longestRun(input.completed) },
        };
      }
      return (
        resumed ??
        (input.available < TUNING.minDeckSize
          ? { kind: "not-enough", available: input.available, streak: gapView }
          : { kind: "recover-offer", streak: gapView })
      );
    }
    case "alive":
    case "broken": {
      const view: StreakView =
        status.kind === "alive"
          ? { kind: "count", value: status.current, yesterdayGap: false }
          : { kind: "restart", longest: status.longest };
      return (
        inProgress(input, view, false) ??
        (input.available < TUNING.minDeckSize
          ? { kind: "not-enough", available: input.available, streak: view }
          : { kind: "ready", streak: view })
      );
    }
  }
}
