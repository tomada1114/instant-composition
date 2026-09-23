import type { Growth, ReviewRow } from "./growth";
import type { HomeState } from "./home-state";
import type { RingProgress } from "./mastery";
import type { Dot } from "./streak";
import type {
  AnswerResult,
  CardContent,
  DayKey,
  Pass,
  RoundKind,
  Settings,
  SubtopicRef,
} from "./types";

/** What the server hands the browser; shared so both sides compile against one shape. */

export interface DrillCard extends CardContent {
  readonly limitMs: number;
}

export interface RoundPayload {
  readonly id: string;
  readonly kind: RoundKind;
  readonly day: DayKey;
  readonly portionDay: DayKey | null;
  /** First-pass card ids in order. */
  readonly deck: readonly string[];
  /** Every card the deck and its retries may show, keyed by id. */
  readonly cards: Readonly<Record<string, DrillCard>>;
  /** What was already answered, oldest first, so a resumed round picks up after it. */
  readonly answered: readonly {
    readonly cardId: string;
    readonly pass: Pass;
    readonly result: AnswerResult;
  }[];
  /** The progress counter reads `offset + position / total`. */
  readonly offset: number;
  readonly total: number;
  /** A placement round has no retry pass. */
  readonly retries: boolean;
}

export interface ReachTopic {
  readonly id: string;
  readonly ja: string;
  readonly count: number;
  /** Mastered in this round. */
  readonly added: number;
  readonly ring: RingProgress;
}

export interface ReachView {
  readonly topics: readonly ReachTopic[];
  readonly nearest: { readonly ja: string; readonly remaining: number } | null;
}

export interface TotalsView {
  readonly said: number;
  readonly practicedDays: number;
  readonly last14: readonly { readonly day: DayKey; readonly count: number }[];
  /** Answers this round added to today's bar. */
  readonly added: number;
}

/** Stored as JSON and served again as is, so an absent value is `null`, never `undefined`. */
export interface RoundSummary {
  readonly roundId: string;
  readonly kind: RoundKind;
  readonly day: DayKey;
  /** Made up yesterday rather than today. */
  readonly yesterday: boolean;
  readonly placement: {
    readonly level: number;
    readonly toeic: string;
    readonly first: boolean;
  } | null;
  readonly growth: Growth;
  readonly review: readonly ReviewRow[];
  readonly streak: {
    readonly value: number;
    /** 0 is never shown: the run is shown as "day 1 from today" instead. */
    readonly restart: boolean;
    readonly changed: boolean;
  };
  readonly week: readonly Dot[];
  /** The day this round completed, lit in the week. */
  readonly filled: DayKey | null;
  readonly difficulty: {
    readonly change: "up" | "down";
    readonly toeic: string;
  } | null;
  readonly reach: ReachView;
  readonly titles: readonly string[];
  readonly topicNames: Readonly<Record<string, string>>;
  readonly points: { readonly earned: number; readonly total: number };
  readonly totals: TotalsView;
  readonly portionCompleted: boolean;
  /** After a yesterday round: today's portion is still open. */
  readonly todayOpen: boolean;
  /** After a placement that counted toward a larger portion: go on with the rest. */
  readonly continueToday: boolean;
}

export interface HomePreview {
  readonly size: number;
  readonly setting: number;
  readonly shortage: boolean;
  readonly reviewCount: number;
  readonly newCount: number;
  readonly focusNames: readonly string[];
  readonly minutes: number;
}

export interface HomeView {
  readonly state: HomeState;
  readonly week: readonly Dot[];
  readonly preview: HomePreview | undefined;
  readonly todayRounds: number;
  readonly todayCards: number;
  /** The size an extra round is dealt at: "one more N". */
  readonly dailySize: number;
  readonly sound: boolean;
  readonly contentError: boolean;
}

export interface SettingsView {
  readonly settings: Settings;
  /** Focus removed because its topic was deselected. */
  readonly removedFocus: readonly SubtopicRef[];
  /** Lowering the size completed today's portion there and then. */
  readonly completedToday: boolean;
}
