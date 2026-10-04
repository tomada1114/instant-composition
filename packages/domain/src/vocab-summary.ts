import type { VocabReview } from "./vocab";

/** First answers in a session's input log order, independent of later re-asks. */
export interface VocabReviewSummary {
  readonly answered: number;
  readonly new: number;
  readonly again: readonly {
    readonly cardId: string;
    readonly headword: string;
    readonly meaning: string;
  }[];
}

/** Re-asks never replace the first-pass grade, even when they sort before it. */
export function summarizeVocabReviews(
  reviews: readonly VocabReview[],
): VocabReviewSummary {
  const seen = new Set<string>();
  const firsts = reviews.filter(({ cardId, pass }) => {
    if (pass !== "first") return false;
    if (seen.has(cardId)) return false;
    seen.add(cardId);
    return true;
  });
  return {
    answered: firsts.length,
    new: firsts.filter((review) => review.before === null).length,
    again: firsts
      .filter((review) => review.grade === "again")
      .map(({ cardId, snapshot }) => ({
        cardId,
        headword: snapshot.headword,
        meaning: snapshot.meaning,
      })),
  };
}
