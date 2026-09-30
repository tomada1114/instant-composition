import type { Growth, ReviewRow } from "./growth";
import type { Dot } from "./streak";
import type { DayKey } from "./types";

/** Everything a finished round's summary shows that the catalog does not supply. */
export interface RoundOutcome {
  readonly placement: { readonly level: number; readonly first: boolean } | null;
  readonly difficulty: {
    readonly change: "up" | "down";
    readonly level: number;
  } | null;
  readonly growth: Growth;
  readonly review: readonly ReviewRow[];
  readonly streak: {
    readonly value: number;
    readonly restart: boolean;
    readonly changed: boolean;
  };
  readonly week: readonly Dot[];
  readonly filled: DayKey | null;
  /** Mastered items per topic after the round, and how many the round added. */
  readonly reach: readonly {
    readonly topic: string;
    readonly count: number;
    readonly added: number;
  }[];
  readonly pending?: number; // Chosen topics' items one OK day short; older outcomes lack it.
  readonly titles: readonly string[];
  readonly points: { readonly earned: number; readonly total: number };
  readonly totals: {
    readonly said: number;
    readonly practicedDays: number;
    readonly last14: readonly { readonly day: DayKey; readonly count: number }[];
    readonly added: number;
  };
  readonly portionCompleted: boolean;
  readonly todayOpen: boolean;
  readonly continueToday: boolean;
}
