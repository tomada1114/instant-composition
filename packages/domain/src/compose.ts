import {
  pickByLevel,
  pickFocus,
  pickWeak,
  subtopicKey,
  type PickState,
} from "./compose-pick";
import { seededRandom, shuffled } from "./random";
import { err, ok, type Result } from "./result";
import { TUNING } from "./tuning";
import type { CardMeta, CardState, ConceptId, DayKey, SubtopicRef } from "./types";

export interface ComposeInput {
  readonly size: number;
  /** Below this many cards nothing is dealt; a resumed round's top-up lowers it. */
  readonly minSize?: number;
  readonly today: DayKey;
  readonly level: number;
  readonly topics: readonly string[];
  readonly focus: readonly SubtopicRef[];
  /** The learner's weak grammar concepts, weakest first. */
  readonly weakConcepts: readonly ConceptId[];
  /** Only the cards that may be shown. */
  readonly cards: readonly CardMeta[];
  readonly states: ReadonlyMap<string, CardState>;
  /** Cards already answered first-pass today, and cards already in this deck. */
  readonly exclude: ReadonlySet<string>;
  readonly seed: string;
}

export interface Composition {
  readonly cardIds: readonly string[];
  readonly reviewCount: number;
  readonly newCount: number;
  readonly focusCount: number;
  /** Cards dealt, new or review, that carry at least one weak concept. */
  readonly weakCount: number;
  /** The weak concepts at least one dealt card carries, weakest first. */
  readonly weakConcepts: readonly ConceptId[];
  /** Fewer cards than asked for, because no more could be dealt. */
  readonly shortage: boolean;
}

export interface NotEnoughCards {
  readonly available: number;
}

type AvailabilityInput = Pick<
  ComposeInput,
  "level" | "topics" | "cards" | "states" | "exclude"
>;

/** Seen cards at any level, and unseen ones within one level of the current one. */
function candidates(input: AvailabilityInput): { seen: CardMeta[]; fresh: CardMeta[] } {
  const inScope = input.cards.filter(
    (card) => input.topics.includes(card.topic) && !input.exclude.has(card.id),
  );
  return {
    seen: inScope.filter((card) => input.states.has(card.id)),
    fresh: inScope.filter(
      (card) => !input.states.has(card.id) && Math.abs(card.level - input.level) <= 1,
    ),
  };
}

/** How many cards a deck could be dealt from: the start screen's "available". */
export function countAvailable(input: AvailabilityInput): number {
  const { seen, fresh } = candidates(input);
  return seen.length + fresh.length;
}

function carriesAny(concepts: ReadonlySet<ConceptId>): (card: CardMeta) => boolean {
  return (card) => card.concepts.some((concept) => concepts.has(concept));
}

/** The earliest due first; on the same due day, a card with a weak concept first. */
function byReviewOrder(
  states: ReadonlyMap<string, CardState>,
  isWeak: (card: CardMeta) => boolean,
) {
  return (a: CardMeta, b: CardMeta): number => {
    const left = states.get(a.id);
    const right = states.get(b.id);
    if (left === undefined || right === undefined) {
      return 0;
    }
    return (
      left.dueDay.localeCompare(right.dueDay) ||
      Number(isWeak(b)) - Number(isWeak(a)) ||
      left.box - right.box ||
      left.lastDay.localeCompare(right.lastDay) ||
      a.id.localeCompare(b.id)
    );
  };
}

/** One pass that swaps a card away from a neighbour of the same subtopic. */
function scatter(deck: readonly CardMeta[]): CardMeta[] {
  const out = [...deck];
  for (let index = 1; index < out.length; index += 1) {
    const before = out[index - 1];
    const current = out[index];
    if (before === undefined || current === undefined) {
      continue;
    }
    const previous = subtopicKey(before);
    if (subtopicKey(current) !== previous) {
      continue;
    }
    const swap = out.findIndex(
      (card, other) => other > index && subtopicKey(card) !== previous,
    );
    const replacement = out[swap];
    if (replacement !== undefined) {
      out[index] = replacement;
      out[swap] = current;
    }
  }
  return out;
}

/**
 * Deals one round: due reviews up to a share of the deck, then new cards (the
 * focus share first, then the weak share), then more reviews to fill whatever
 * new cards could not.
 */
export function compose(input: ComposeInput): Result<Composition, NotEnoughCards> {
  const { seen, fresh } = candidates(input);
  const available = seen.length + fresh.length;
  if (Math.min(input.size, available) < (input.minSize ?? TUNING.minDeckSize)) {
    return err({ available });
  }

  const random = seededRandom(input.seed);
  const isWeak = carriesAny(new Set(input.weakConcepts));
  const order = byReviewOrder(input.states, isWeak);
  const dueSorted = seen
    .filter((card) => (input.states.get(card.id)?.dueDay ?? "") <= input.today)
    .sort(order);
  const notDueSorted = seen.filter((card) => !dueSorted.includes(card)).sort(order);

  const reviewSlots = Math.min(
    dueSorted.length,
    Math.floor(input.size * TUNING.mix.reviewShareMax),
  );
  const reviews = dueSorted.slice(0, reviewSlots);
  const newSlots = input.size - reviewSlots;

  const state: PickState = { random, counts: new Map(), taken: new Set() };
  const focusQuota =
    input.focus.length === 0 ? 0 : Math.floor(newSlots * TUNING.mix.focusShareOfNew);
  const focused = pickFocus(fresh, input.focus, focusQuota, input.level, state);
  const weakQuota = Math.min(
    newSlots - focused.length,
    Math.floor(newSlots * TUNING.mix.weakShareOfNew),
  );
  const weak = pickWeak(fresh, input.weakConcepts, weakQuota, input.level, state);
  const targeted = [...focused, ...weak];
  const rest = pickByLevel(fresh, newSlots - targeted.length, input.level, state);

  const fillers = [...dueSorted.slice(reviewSlots), ...notDueSorted].slice(
    0,
    input.size - reviews.length - targeted.length - rest.length,
  );
  const deck = [...reviews, ...targeted, ...rest, ...fillers];
  const dealtConcepts = new Set(deck.flatMap((card) => card.concepts));

  return ok({
    cardIds: scatter(shuffled(deck, random)).map((card) => card.id),
    reviewCount: reviews.length + fillers.length,
    newCount: targeted.length + rest.length,
    focusCount: focused.length,
    weakCount: deck.filter(isWeak).length,
    weakConcepts: input.weakConcepts.filter((concept) => dealtConcepts.has(concept)),
    shortage: deck.length < input.size,
  });
}
