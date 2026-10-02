import {
  inLevelBand,
  levelPlan,
  pickByLevel,
  pickFocus,
  pickWeak,
  type PickState,
} from "./compose-pick";
import { dayDiff } from "./day";
import { retrievability, type FsrsState } from "./fsrs";
import { todaysQueue, type DailyLimit, type QueuedCard } from "./queue";
import type { Random } from "./random";
import { TUNING } from "./tuning";
import type { CardMeta, ConceptId, DayKey, SubtopicRef } from "./types";

/** A card the learner has answered in the drill, as a deal reads it. */
export interface SeenCard {
  /** Null for a card answered only before FSRS: it is dealt as a review. */
  readonly state: FsrsState | null;
  /** When its latest first pass came; the cards with no state go oldest first. */
  readonly lastAnsweredAt: number;
}

/** What today's drill queue is built from, taken once per command or query. */
export interface DrillQueueInput {
  readonly today: DayKey;
  readonly level: number;
  readonly topics: readonly string[];
  readonly focus: readonly SubtopicRef[];
  /** The learner's weak grammar concepts, weakest first. */
  readonly weakConcepts: readonly ConceptId[];
  /** Only the cards that may be shown. */
  readonly cards: readonly CardMeta[];
  readonly seen: ReadonlyMap<string, SeenCard>;
  /** Cards whose first answer today is in: never dealt twice in a day. */
  readonly answeredToday: ReadonlySet<string>;
  readonly newLimit: DailyLimit;
  /** What the review limit leaves after the reviews answered today. */
  readonly reviewLimit: DailyLimit;
  readonly newAnsweredToday: number;
}

export interface DrillQueue {
  /** Today's cards: due reviews, the least likely recalled first, new ones spread among them. */
  readonly queue: readonly QueuedCard[];
  /** Due reviews past the review limit, in the same order. */
  readonly dueBeyond: readonly string[];
  /** New cards in the level band that today's queue left out, in the catalog's order. */
  readonly freshBeyond: readonly CardMeta[];
  /** Seen cards not yet due, the least likely recalled first. */
  readonly notDue: readonly string[];
  /** How many cards the limits ask for; fewer in `queue` means new cards ran out. */
  readonly wanted: number;
  /** The new cards picked for the focus share. */
  readonly focused: ReadonlySet<string>;
}

/**
 * `count` new cards from `pool` as a deck takes them: the focus share first,
 * then the weak share, their levels planned over all of them together.
 */
export function pickNew(
  pool: readonly CardMeta[],
  count: number,
  input: Pick<DrillQueueInput, "level" | "focus" | "weakConcepts">,
  random: Random,
): { readonly cards: readonly CardMeta[]; readonly focused: readonly CardMeta[] } {
  const { level } = input;
  const state: PickState = {
    random,
    counts: new Map(),
    taken: new Set(),
    plan: levelPlan(count, level),
  };
  const focusQuota =
    input.focus.length === 0 ? 0 : Math.floor(count * TUNING.mix.focusShareOfNew);
  const focused = pickFocus(pool, input.focus, focusQuota, level, state);
  const weakQuota = Math.min(
    count - focused.length,
    Math.floor(count * TUNING.mix.weakShareOfNew),
  );
  const weak = pickWeak(pool, input.weakConcepts, weakQuota, level, state);
  const rest = pickByLevel(pool, count - focused.length - weak.length, level, state);
  return { cards: [...focused, ...weak, ...rest], focused };
}

function quota(limit: DailyLimit): number {
  return limit === "unlimited" ? Number.POSITIVE_INFINITY : Math.max(0, limit);
}

/**
 * Today's drill queue under the daily limits (`todaysQueue`). A card seen
 * only before FSRS counts as a due review; a card never seen in the band takes
 * the new quota, and only the number of new cards comes from the limit: which
 * ones is the focus, weak and level shares' choice. `dealt` holds cards
 * already in a deck: they count against the limits and are not dealt again.
 */
export function drillQueue(
  input: DrillQueueInput,
  dealt: ReadonlySet<string>,
  random: Random,
): DrillQueue {
  const inScope = input.cards.filter(
    (card) => input.topics.includes(card.topic) && !input.answeredToday.has(card.id),
  );
  const seen = inScope.flatMap((card) => {
    const known = input.seen.get(card.id);
    return known === undefined ? [] : [{ card, ...known }];
  });
  const fresh = inScope.filter(
    (card) => !input.seen.has(card.id) && inLevelBand(card.level, input.level),
  );
  // Cards with no state follow the scheduled ones in this order.
  const reviews = [...seen]
    .sort(
      (a, b) =>
        a.lastAnsweredAt - b.lastAnsweredAt || a.card.id.localeCompare(b.card.id),
    )
    .map(({ card, state }) => ({
      cardId: card.id,
      state: state ?? undefined,
      isNew: false,
    }));
  const queueOf = (order: readonly CardMeta[]) =>
    todaysQueue({
      ...input,
      candidates: [
        ...reviews,
        ...order.map((card) => ({ cardId: card.id, state: undefined, isNew: true })),
      ],
      answeredToday: new Set(),
    });
  const counted = queueOf(fresh).queue;
  const reviewCount = counted.filter((card) => card.kind === "review").length;
  const held = fresh.filter((card) => dealt.has(card.id));
  const open = fresh.filter((card) => !dealt.has(card.id));
  const newCount = counted.length - reviewCount;
  const picked = pickNew(open, Math.max(0, newCount - held.length), input, random);
  const { queue, extra } = queueOf([
    ...held,
    ...picked.cards,
    ...open.filter((card) => !picked.cards.includes(card)),
  ]);
  const queued = new Set(queue.map((card) => card.cardId));
  const today = input.today;
  const recall = (state: FsrsState) => retrievability(state, today);
  return {
    queue: queue.filter((card) => !dealt.has(card.cardId)),
    dueBeyond: extra
      .filter((card) => card.kind === "review" && !dealt.has(card.cardId))
      .map((card) => card.cardId),
    freshBeyond: open.filter((card) => !queued.has(card.id)),
    notDue: seen
      .flatMap(({ card, state }) =>
        state === null || dayDiff(state.dueDay, today) >= 0 || dealt.has(card.id)
          ? []
          : [{ id: card.id, recall: recall(state) }],
      )
      .sort((a, b) => a.recall - b.recall || a.id.localeCompare(b.id))
      .map(({ id }) => id),
    wanted:
      reviewCount +
      Math.max(
        0,
        Math.min(
          quota(input.newLimit) - input.newAnsweredToday,
          quota(input.reviewLimit) - reviewCount,
        ),
      ),
    focused: new Set(picked.focused.map((card) => card.id)),
  };
}
