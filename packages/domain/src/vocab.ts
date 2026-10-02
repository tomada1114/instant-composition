import { retrievability, type FsrsGrade, type FsrsState } from "./fsrs";
import { VOCAB_TUNING } from "./tuning";
import type { DayKey, Pass, VocabNewPerDay, VocabReviewsPerDay } from "./types";

/** The four kinds of vocabulary card, in the order new cards take turns in. */
export type VocabCategory = (typeof VOCAB_TUNING.categories)[number];

/** What the vocabulary rules read of a card the catalog shows. */
export interface VocabCard {
  readonly id: string;
  readonly category: VocabCategory;
  readonly level: number;
}

/** Where a card in the learner's vocabulary came from: the catalog, or a talk's turn. */
export type VocabSource =
  | { readonly kind: "catalog" }
  | { readonly kind: "talk"; readonly talkId: string; readonly turn: number };

/** One vocabulary card's projection, beside its append-only reviews. */
export interface VocabProgress {
  readonly cardId: string;
  readonly source: VocabSource;
  /** Null until an answer first moves the card: it is new until then. */
  readonly state: FsrsState | null;
  /** The practice day its first answer moved it on, which is the day it was introduced. */
  readonly firstDay: DayKey | null;
}

/** What a vocabulary session deals: today's queue, more past it, or the weak cards. */
export type VocabSessionKind = "today" | "extra" | "weak";

/** A vocabulary session, keyed apart from the drill's rounds. */
export interface VocabSession {
  readonly id: string;
  readonly kind: VocabSessionKind;
  /** The category the deal was restricted to, or null for all of them. */
  readonly category: VocabCategory | null;
  /** The day it started on, which every answer in it counts for. */
  readonly day: DayKey;
  /** The card ids dealt, in the order they are shown. */
  readonly deck: readonly string[];
  readonly startedAt: number;
  readonly finishedAt: number | null;
  /** Reviews due by the day after, as counted when it finished; null until then. */
  readonly tomorrow: number | null;
}

/** The card as it was when answered, so the entry outlives the card. */
export interface VocabSnapshot {
  readonly headword: string;
  readonly meaning: string;
  readonly category: VocabCategory;
  readonly level: number;
}

/** One answer of a vocabulary session. Never updated once written. */
export interface VocabReview {
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  readonly id: string;
  readonly sessionId: string;
  readonly cardId: string;
  readonly answeredAt: number;
  /** The session's day, not the wall-clock day of the answer. */
  readonly day: DayKey;
  readonly pass: Pass;
  readonly grade: FsrsGrade;
  /** Until the flip. */
  readonly elapsedMs: number;
  /** The card's state around this answer; equal when it did not move the card. */
  readonly before: FsrsState | null;
  readonly after: FsrsState | null;
  readonly snapshot: VocabSnapshot;
}

/** One vocabulary answer as the client sends it; the session comes from the path. */
export interface VocabAnswer {
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  readonly id: string;
  readonly cardId: string;
  readonly pass: Pass;
  readonly grade: FsrsGrade;
  readonly elapsedMs: number;
  /** Epoch ms on the client's clock; absent, the server's time is taken. */
  readonly answeredAt?: number;
}

/** What every vocabulary deal reads: the catalog's cards and the learner's progress on them. */
export interface VocabState {
  readonly today: DayKey;
  /** The drill's level, which the new cards' band is built around. */
  readonly level: number;
  /** The cards the catalog shows, in its order. */
  readonly cards: readonly VocabCard[];
  readonly progress: ReadonlyMap<string, VocabProgress>;
  readonly newPerDay: VocabNewPerDay;
  readonly reviewsPerDay: VocabReviewsPerDay;
}

/**
 * Whether a card is weak: it came from a talk, or lapsed
 * `VOCAB_TUNING.weak.lapses` times, and its stability has not yet reached
 * `VOCAB_TUNING.weak.exitStabilityDays`. Derived on every read, never stored.
 */
export function isWeak(progress: VocabProgress | undefined): boolean {
  if (progress === undefined) {
    return false;
  }
  const { state, source } = progress;
  const marked =
    source.kind === "talk" ||
    (state !== null && state.lapses >= VOCAB_TUNING.weak.lapses);
  return (
    marked && (state === null || state.stability < VOCAB_TUNING.weak.exitStabilityDays)
  );
}

/** Whether a card has yet to be answered: it takes the new quota. */
export function isNewCard(progress: VocabProgress | undefined): boolean {
  return (progress?.state ?? null) === null;
}

/** Whether a card's first answer of `today` is already in. */
export function answeredOn(
  progress: VocabProgress | undefined,
  today: DayKey,
): boolean {
  return progress?.state?.lastDay === today;
}

/** A card's recall on `today`, lowest first to deal; a new card ranks below every other. */
export function recallOf(progress: VocabProgress | undefined, today: DayKey): number {
  const state = progress?.state ?? null;
  return state === null ? Number.NEGATIVE_INFINITY : retrievability(state, today);
}

/** Cards of one level, the categories taking turns, each category in its given order. */
function inTurn(cards: readonly VocabCard[]): VocabCard[] {
  const queues = VOCAB_TUNING.categories.map((category) =>
    cards.filter((card) => card.category === category),
  );
  const longest = Math.max(0, ...queues.map((queue) => queue.length));
  return Array.from({ length: longest }, (_, index) =>
    queues.flatMap((queue) => queue[index] ?? []),
  ).flat();
}

/**
 * New cards in the order they are dealt: weak ones first, then the learner's
 * level band from one below `level` up — lowest level first, the categories
 * taking turns within a level — and past the band the next level up. A card
 * below the band is never dealt new, unless it is weak.
 */
export function newCardOrder(
  cards: readonly VocabCard[],
  level: number,
  weak: (cardId: string) => boolean,
): VocabCard[] {
  const levels = [
    ...new Set(cards.filter((card) => card.level >= level - 1).map((c) => c.level)),
  ].sort((a, b) => a - b);
  const plain = cards.filter((card) => !weak(card.id));
  return [
    ...cards.filter((card) => weak(card.id)),
    ...levels.flatMap((step) => inTurn(plain.filter((card) => card.level === step))),
  ];
}
