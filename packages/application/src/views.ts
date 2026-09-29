import type {
  AnswerResult,
  DayKey,
  Dot,
  Growth,
  Pass,
  ReviewRow,
  RingProgress,
  RoundKind,
  Settings,
  SubtopicRef,
} from "@instant-composition/domain";

/** What a command hands back to a client, in the shapes the screens read. */

/** A card as the drill shows it: `drillCardSchema`'s fields, and no others. */
export interface DrillCard {
  readonly id: string;
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly words: number;
  readonly prompt: string;
  /** The model answer, in the target language. */
  readonly text: string;
  readonly alternatives: readonly string[];
  readonly explanation: string;
  /** When the timer runs out: the limit the round was dealt with. */
  readonly limitMs: number;
  /** What a flip is "fast" against, from the model answer's length. */
  readonly paceMs: number;
}

export interface RoundPayload {
  readonly id: string;
  readonly kind: RoundKind;
  readonly day: DayKey;
  readonly portionDay: DayKey | null;
  /** First-pass card ids in order. */
  readonly deck: readonly string[];
  /** Every shown card the deck and its retries may show, keyed by id; a card edited since its review is left out. */
  readonly cards: Readonly<Record<string, DrillCard>>;
  /** What was already answered, oldest first, so a resumed round picks up after it. */
  readonly answered: readonly {
    /** The answer's own id, so a client can tell which of its queued answers are held. */
    readonly id: string;
    readonly cardId: string;
    readonly pass: Pass;
    readonly result: AnswerResult;
    /** As stored: the client's time, held between the round's start and the server's. */
    readonly answeredAt: number;
  }[];
  /** The progress counter reads `offset + position / total`. */
  readonly offset: number;
  readonly total: number;
  /** A placement round has no retry pass. */
  readonly retries: boolean;
}

export interface ReachTopic {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** Mastered in this round. */
  readonly added: number;
  readonly ring: RingProgress;
}

export interface ReachView {
  readonly topics: readonly ReachTopic[];
  readonly nearest: { readonly name: string; readonly remaining: number } | null;
}

export interface TotalsView {
  readonly said: number;
  readonly practicedDays: number;
  readonly last14: readonly { readonly day: DayKey; readonly count: number }[];
  /** Answers this round added to today's bar. */
  readonly added: number;
}

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

export interface SettingsView {
  readonly settings: Required<Settings>;
  /** Focus removed because its topic was deselected. */
  readonly removedFocus: readonly SubtopicRef[];
  /** Lowering the size completed today's portion there and then. */
  readonly completedToday: boolean;
}
