import {
  gradeOf,
  intervalsOf,
  limitMsOf,
  paceMsForWords,
  type ItemProgress,
  type Portion,
  type ReviewEntry,
  type Round,
} from "@instant-composition/domain";

import type { CatalogSnapshot } from "./catalog";
import type { AnsweredRow, DrillCard, RoundPayload } from "./views";

/** A round's answers as a client reads them back. */
export function answeredOf(reviews: readonly ReviewEntry[]): AnsweredRow[] {
  return reviews.map((review) => ({
    id: review.id,
    cardId: review.item.id,
    pass: review.detail.pass,
    result: review.detail.result,
    ...gradeOf(review.detail),
    answeredAt: review.answeredAt,
  }));
}

/**
 * Whether a card was new when dealt, and each grade's interval for its first
 * answer on the round's day. A card answered already is read from the state
 * that answer found, so a resumed round shows what it was dealt with.
 */
function scheduleOf(
  round: Round,
  id: string,
  first: ReviewEntry | undefined,
  progress: ItemProgress | undefined,
): Pick<DrillCard, "intervals" | "isNew"> {
  const state =
    first === undefined ? progress?.fsrs : (first.fsrs?.before ?? undefined);
  const isNew =
    first === undefined
      ? progress === undefined
      : first.before === null && (first.fsrs?.before ?? null) === null;
  return { intervals: intervalsOf(state, round.day, id), isNew };
}

/**
 * The round as the drill needs it: its cards with the limit the round was
 * dealt with, each card's pace and intervals, and where it stands.
 */
export function payloadOf(
  round: Round,
  reviews: readonly ReviewEntry[],
  portion: Portion | undefined,
  snapshot: CatalogSnapshot,
  items: ReadonlyMap<string, ItemProgress>,
): RoundPayload {
  const firsts = new Map(
    reviews
      .filter((review) => review.detail.pass === "first")
      .map((review) => [review.item.id, review]),
  );
  const cards: Record<string, DrillCard> = {};
  for (const id of round.deck) {
    const card = snapshot.shown.get(id);
    if (card !== undefined) {
      // Picked field by field: the response is not stripped to the contract, so a
      // spread would put every field a card gains, such as its concepts, on the wire.
      const { topic, subtopic, level, words, prompt, text, alternatives, explanation } =
        card;
      const paceMs = paceMsForWords(words);
      cards[id] = {
        id,
        topic,
        subtopic,
        level,
        words,
        prompt,
        text,
        alternatives,
        explanation,
        limitMs: limitMsOf(round, paceMs),
        paceMs,
        ...scheduleOf(round, id, firsts.get(id), items.get(id)),
      };
    }
  }
  const counted = round.kind !== "placement" && portion !== undefined;
  return {
    id: round.id,
    kind: round.kind,
    day: round.day,
    portionDay: round.portionDay,
    deck: round.deck,
    cards,
    answered: answeredOf(reviews),
    offset: counted ? portion.progress - round.firstPass : 0,
    total: counted ? portion.target : round.deck.length,
    retries: round.kind !== "placement",
  };
}
