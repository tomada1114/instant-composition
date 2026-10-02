import { compose, composeExtra, countAvailable, type Composition } from "./compose";
import type { DrillQueueInput } from "./drill-queue";
import type { PracticeError } from "./errors";
import type { ItemProgress, LearnerStats, Round } from "./records";
import { err, ok, type Result } from "./result";
import { TUNING } from "./tuning";
import type {
  CardMeta,
  DayKey,
  DrillNewPerDay,
  DrillReviewsPerDay,
  LimitSeconds,
  RoundKind,
  Settings,
} from "./types";
import { drillLimitsOf, limitSecondsOf } from "./settings";
import { weaknesses } from "./weakness";

/** What dealing a deck reads, taken once per command or query. */
export interface PracticeState extends DrillQueueInput {
  readonly newPerDay: DrillNewPerDay;
  readonly reviewsPerDay: DrillReviewsPerDay;
  /** The per-card limit a round dealt now records. */
  readonly limitSeconds: LimitSeconds;
}

/**
 * The dealing state for `today`. An item whose state, FSRS or else Leitner,
 * was last moved today was answered today; one moved then for the first time,
 * with no Leitner history, was new, and any other counts against the review
 * limit.
 */
export function practiceState(input: {
  readonly today: DayKey;
  readonly stats: LearnerStats;
  readonly settings: Settings | undefined;
  readonly cards: readonly CardMeta[];
  readonly items: ReadonlyMap<string, ItemProgress>;
}): PracticeState {
  const items = [...input.items.values()];
  const shown = new Map(input.cards.map((card) => [card.id, card]));
  const { newPerDay, reviewsPerDay } = drillLimitsOf(input.settings);
  const answered = items.filter(
    (progress) => (progress.fsrs?.lastDay ?? progress.memory?.lastDay) === input.today,
  );
  const newAnswered = answered.filter(
    (progress) => progress.memory === undefined && progress.fsrs?.reps === 1,
  ).length;
  return {
    today: input.today,
    level: input.stats.level?.level ?? 1,
    topics: input.settings?.topics ?? [],
    focus: input.settings?.focus ?? [],
    newPerDay,
    reviewsPerDay,
    limitSeconds: limitSecondsOf(input.settings),
    weakConcepts: weaknesses({ items, shown }).grammar.map((weak) => weak.concept),
    cards: input.cards,
    seen: new Map(
      items.map((progress) => [
        progress.item.id,
        {
          state: progress.fsrs ?? null,
          lastAnsweredAt: progress.last?.answeredAt ?? 0,
        },
      ]),
    ),
    answeredToday: new Set(answered.map((progress) => progress.item.id)),
    newLimit: newPerDay,
    reviewLimit:
      reviewsPerDay === null
        ? "unlimited"
        : Math.max(0, reviewsPerDay - (answered.length - newAnswered)),
    newAnsweredToday: newAnswered,
  };
}

/** How many cards a portion could be dealt from today: its queue and what may top it up. */
export function availableFor(practice: PracticeState): number {
  return countAvailable(practice);
}

/** The seed a round of `kind` started now would use, so a preview deals the same cards. */
export function seedFor(today: DayKey, kind: RoundKind, roundsStarted: number): string {
  return `${today}:${kind}:${String(roundsStarted)}`;
}

export function deal(
  practice: PracticeState,
  options: {
    readonly size: number;
    readonly seed: string;
    readonly exclude?: readonly string[];
    readonly minSize?: number;
  },
): Result<Composition, PracticeError> {
  const dealt = compose({
    ...practice,
    size: options.size,
    minSize: options.minSize ?? Math.min(TUNING.minDeckSize, options.size),
    exclude: new Set(options.exclude ?? []),
    seed: options.seed,
  });
  return dealt.ok
    ? ok(dealt.value)
    : err({ code: "ERR_NOT_ENOUGH_CARDS", available: dealt.error.available });
}

/** An extra round's deck; see `composeExtra`. */
export function dealExtraDeck(
  practice: PracticeState,
  seed: string,
): Result<Composition, PracticeError> {
  const dealt = composeExtra({ ...practice, seed });
  return dealt.ok
    ? ok(dealt.value)
    : err({ code: "ERR_NOT_ENOUGH_CARDS", available: dealt.error.available });
}

/**
 * `round`'s deck with its unanswered tail rewritten to `remaining` cards: cards
 * no longer shown are dropped, then the tail is cut or topped up by the same
 * dealing rules. A placement deck is only ever cut.
 */
export function refitDeck(
  practice: PracticeState,
  round: Round,
  answered: ReadonlySet<string>,
  remaining: number,
): readonly string[] {
  const shown = new Set(practice.cards.map((card) => card.id));
  const done = round.deck.filter((id) => answered.has(id));
  const open = round.deck.filter((id) => !answered.has(id) && shown.has(id));
  let tail = open.slice(0, Math.max(0, remaining));
  const missing = remaining - tail.length;
  if (missing > 0 && round.kind !== "placement") {
    const topUp = deal(practice, {
      size: missing,
      minSize: 1,
      seed: `${round.id}:${String(round.deck.length)}`,
      exclude: [...round.deck],
    });
    if (topUp.ok) {
      tail = [...tail, ...topUp.value.cardIds];
    }
  }
  return [...done, ...tail];
}
