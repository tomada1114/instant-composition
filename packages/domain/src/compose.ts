import {
  drillQueue,
  pickNew,
  type DrillQueue,
  type DrillQueueInput,
} from "./drill-queue";
import { seededRandom } from "./random";
import { err, ok, type Result } from "./result";
import { TUNING } from "./tuning";
import type { CardMeta, ConceptId } from "./types";

export interface ComposeInput extends DrillQueueInput {
  readonly size: number;
  /** Below this many cards nothing is dealt; a resumed round's top-up lowers it. */
  readonly minSize?: number;
  /** Cards already in this deck: they count against today's limits, and are not dealt again. */
  readonly exclude: ReadonlySet<string>;
  readonly seed: string;
}

export interface Composition {
  readonly cardIds: readonly string[];
  /** Reviews, and the cards not yet due that topped the deck up. */
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

/** Today's queue for counting: which new cards it would pick does not change how many. */
function counted(input: DrillQueueInput): DrillQueue {
  return drillQueue(input, new Set(), seededRandom(input.today));
}

/**
 * How many cards a portion could be dealt from: today's queue and the cards
 * not yet due that may top it up. The start screen's "available".
 */
export function countAvailable(input: DrillQueueInput): number {
  const { queue, notDue } = counted(input);
  return queue.length + notDue.length;
}

/**
 * The size of a portion `done` cards into it: those and today's queue, which
 * the daily limits size. A portion under `TUNING.minDeckSize` is topped up
 * with cards not yet due as far as they reach.
 */
export function portionSize(input: DrillQueueInput, done: number): number {
  const { queue, notDue } = counted(input);
  const total = done + queue.length;
  return total >= TUNING.minDeckSize
    ? total
    : Math.min(TUNING.minDeckSize, total + notDue.length);
}

/** How many cards the limits ask of today; a portion under it means new cards ran out. */
export function wantedToday(input: DrillQueueInput): number {
  return counted(input).wanted;
}

function carriesAny(concepts: ReadonlySet<ConceptId>): (card: CardMeta) => boolean {
  return (card) => card.concepts.some((concept) => concepts.has(concept));
}

function compositionOf(
  input: DrillQueueInput & { readonly size: number },
  deck: readonly string[],
  fresh: ReadonlySet<string>,
  focused: ReadonlySet<string>,
): Composition {
  const byId = new Map(input.cards.map((card) => [card.id, card]));
  const cards = deck.flatMap((id) => byId.get(id) ?? []);
  const newCount = deck.filter((id) => fresh.has(id)).length;
  const dealtConcepts = new Set(cards.flatMap((card) => card.concepts));
  return {
    cardIds: deck,
    reviewCount: deck.length - newCount,
    newCount,
    focusCount: deck.filter((id) => focused.has(id)).length,
    weakCount: cards.filter(carriesAny(new Set(input.weakConcepts))).length,
    weakConcepts: input.weakConcepts.filter((concept) => dealtConcepts.has(concept)),
    shortage: deck.length < input.size,
  };
}

/**
 * Deals up to `size` cards of today's queue, in its order, then tops the deck
 * up with seen cards not yet due, the least likely recalled first.
 */
export function compose(input: ComposeInput): Result<Composition, NotEnoughCards> {
  const drill = drillQueue(input, input.exclude, seededRandom(input.seed));
  const available = drill.queue.length + drill.notDue.length;
  if (Math.min(input.size, available) < (input.minSize ?? TUNING.minDeckSize)) {
    return err({ available });
  }
  const deck = [...drill.queue.map((card) => card.cardId), ...drill.notDue].slice(
    0,
    input.size,
  );
  const fresh = drill.queue.filter((card) => card.kind === "new");
  return ok(
    compositionOf(
      input,
      deck,
      new Set(fresh.map((card) => card.cardId)),
      drill.focused,
    ),
  );
}

/**
 * An extra round past today's queue, `TUNING.extraSize` cards: due reviews
 * past the review limit first, the least likely recalled first, then new cards
 * past the new limit, chosen as a deal chooses them. No card not yet due.
 */
export function composeExtra(
  input: DrillQueueInput & { readonly seed: string },
): Result<Composition, NotEnoughCards> {
  const random = seededRandom(input.seed);
  const drill = drillQueue(input, new Set(), random);
  const size = TUNING.extraSize;
  const reviews = drill.dueBeyond.slice(0, size);
  const picked = pickNew(drill.freshBeyond, size - reviews.length, input, random);
  const deck = [...reviews, ...picked.cards.map((card) => card.id)];
  if (deck.length === 0) {
    return err({ available: 0 });
  }
  return ok(
    compositionOf(
      { ...input, size },
      deck,
      new Set(picked.cards.map((card) => card.id)),
      new Set(picked.focused.map((card) => card.id)),
    ),
  );
}
