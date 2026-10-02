import { dayDiff } from "./day";
import { retrievability, type FsrsState } from "./fsrs";
import type { DayKey } from "./types";

/** How many cards of one kind a day may bring. */
export type DailyLimit = number | "unlimited";

/** A card that may be dealt today. */
export interface QueueCandidate {
  readonly cardId: string;
  /** Undefined for a card with no FSRS answer yet. */
  readonly state: FsrsState | undefined;
  /**
   * Whether the card takes the new quota. The caller decides: a card seen
   * before FSRS, with no state, may still count as a review.
   */
  readonly isNew: boolean;
}

export interface QueueInput {
  readonly today: DayKey;
  /** New candidates in the order they are to be dealt; reviews in any order. */
  readonly candidates: readonly QueueCandidate[];
  readonly newLimit: DailyLimit;
  readonly reviewLimit: DailyLimit;
  /** Cards whose first answer today is already in. */
  readonly answeredToday: ReadonlySet<string>;
  /** How many of those took the new quota. */
  readonly newAnsweredToday: number;
}

export interface QueuedCard {
  readonly cardId: string;
  readonly kind: "new" | "review";
}

export interface TodaysQueue {
  /** Today's cards: due reviews with the new cards spread evenly among them. */
  readonly queue: readonly QueuedCard[];
  /** What more practice takes, in order: due reviews past the limit, then new cards. */
  readonly extra: readonly QueuedCard[];
}

function quota(limit: DailyLimit): number {
  return limit === "unlimited" ? Number.POSITIVE_INFINITY : Math.max(0, limit);
}

/**
 * Due reviews, lowest retrievability first. A review with no FSRS state has no
 * retrievability to rank by and follows the scheduled ones in the caller's
 * order, so a backlog of cards seen before FSRS never holds a scheduled card
 * past its day.
 */
function dueReviews(input: QueueInput): QueuedCard[] {
  const scheduled: { readonly cardId: string; readonly recall: number }[] = [];
  const unscheduled: string[] = [];
  for (const { cardId, state, isNew } of input.candidates) {
    if (isNew || input.answeredToday.has(cardId)) {
      continue;
    }
    if (state === undefined) {
      unscheduled.push(cardId);
    } else if (dayDiff(state.dueDay, input.today) >= 0) {
      scheduled.push({ cardId, recall: retrievability(state, input.today) });
    }
  }
  return [
    ...scheduled.sort((a, b) => a.recall - b.recall).map(({ cardId }) => cardId),
    ...unscheduled,
  ].map((cardId) => ({ cardId, kind: "review" }));
}

/** New card `i` of `n` follows the first `floor((i + 1) · reviews / n)` reviews. */
function spread(
  reviews: readonly QueuedCard[],
  fresh: readonly QueuedCard[],
): QueuedCard[] {
  const queue: QueuedCard[] = [];
  let placed = 0;
  fresh.forEach((card, index) => {
    const before = Math.floor(((index + 1) * reviews.length) / fresh.length);
    queue.push(...reviews.slice(placed, before), card);
    placed = before;
  });
  return [...queue, ...reviews.slice(placed)];
}

/**
 * Today's queue: due reviews up to the review limit, then new cards up to the
 * smaller of what the new limit leaves after today's new answers and what the
 * review limit leaves after the reviews — so a backlog of reviews holds new
 * cards back instead of growing. A card not yet due is never dealt.
 */
export function todaysQueue(input: QueueInput): TodaysQueue {
  const due = dueReviews(input);
  const fresh: QueuedCard[] = input.candidates
    .filter(({ cardId, isNew }) => isNew && !input.answeredToday.has(cardId))
    .map(({ cardId }) => ({ cardId, kind: "new" }));
  const reviewQuota = quota(input.reviewLimit);
  const reviews = due.slice(0, reviewQuota);
  const newCount = Math.max(
    0,
    Math.min(
      quota(input.newLimit) - input.newAnsweredToday,
      reviewQuota - reviews.length,
    ),
  );
  return {
    queue: spread(reviews, fresh.slice(0, newCount)),
    extra: [...due.slice(reviews.length), ...fresh.slice(newCount)],
  };
}
