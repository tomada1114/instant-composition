import { compose, countAvailable, type Composition } from "./compose";
import type { PracticeError } from "./errors";
import type { ItemProgress, LearnerStats, Round } from "./records";
import { err, ok, type Result } from "./result";
import { TUNING } from "./tuning";
import type {
  CardMeta,
  CardState,
  DailySize,
  DayKey,
  RoundKind,
  Settings,
  SubtopicRef,
} from "./types";

/** What dealing a deck reads, taken once per command or query. */
export interface PracticeState {
  readonly today: DayKey;
  readonly level: number;
  readonly topics: readonly string[];
  readonly focus: readonly SubtopicRef[];
  readonly dailySize: DailySize;
  /** Only the cards a round may deal. */
  readonly cards: readonly CardMeta[];
  readonly states: ReadonlyMap<string, CardState>;
  /** Cards already given a first-pass answer today: never dealt twice in a day. */
  readonly answeredToday: ReadonlySet<string>;
}

export function practiceState(input: {
  readonly today: DayKey;
  readonly stats: LearnerStats;
  readonly settings: Settings | undefined;
  readonly cards: readonly CardMeta[];
  readonly items: ReadonlyMap<string, ItemProgress>;
}): PracticeState {
  const items = [...input.items.values()];
  return {
    today: input.today,
    level: input.stats.level?.level ?? 1,
    topics: input.settings?.topics ?? [],
    focus: input.settings?.focus ?? [],
    dailySize: input.settings?.dailySize ?? TUNING.defaultDailySize,
    cards: input.cards,
    states: new Map(items.map((progress) => [progress.item.id, progress.memory])),
    answeredToday: new Set(
      items
        .filter((progress) => progress.memory.lastDay === input.today)
        .map((progress) => progress.item.id),
    ),
  };
}

function exclusion(practice: PracticeState, extra: readonly string[]): Set<string> {
  return new Set([...practice.answeredToday, ...extra]);
}

/** How many cards could be dealt today, leaving out `extra` besides today's answers. */
export function availableFor(
  practice: PracticeState,
  extra: readonly string[] = [],
): number {
  return countAvailable({ ...practice, exclude: exclusion(practice, extra) });
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
    exclude: exclusion(practice, options.exclude ?? []),
    seed: options.seed,
  });
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
