import { describe, expect, it } from "vitest";
import { summarizeVocabReviews } from "@instant-composition/domain";
import { makeVocabReview } from "./application-fixtures";

describe("vocabulary summaries retain first-pass grades across reordered re-asks", () => {
  it.each(["same-time", "older-client-time"] as const)(
    "ignores a retry ordered before its first pass (%s)",
    (time) => {
      const first = makeVocabReview({
        id: "z-first",
        pass: "first",
        grade: "again",
        before: null,
        answeredAt: 5000,
      });
      const retry = makeVocabReview({
        ...first,
        id: "a-retry",
        pass: "retry",
        grade: "good",
        before: first.after,
        answeredAt: time === "same-time" ? 5000 : 4000,
      });
      expect(summarizeVocabReviews([retry, first])).toStrictEqual({
        answered: 1,
        new: 1,
        again: [
          {
            cardId: first.cardId,
            headword: first.snapshot.headword,
            meaning: first.snapshot.meaning,
          },
        ],
      });
    },
  );

  it("does not manufacture a first-pass total from a lone retry", () => {
    expect(summarizeVocabReviews([makeVocabReview({ pass: "retry" })])).toStrictEqual({
      answered: 0,
      new: 0,
      again: [],
    });
  });
});
