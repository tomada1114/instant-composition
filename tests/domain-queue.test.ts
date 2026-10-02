import { describe, expect, it } from "vitest";

import {
  todaysQueue,
  type FsrsState,
  type QueueCandidate,
  type QueueInput,
} from "@instant-composition/domain";

const TODAY = "2026-10-20";

/**
 * A review last answered ten days ago and due by today. Its retrievability
 * rises with its stability, so `stability` alone sets its rank.
 */
function review(cardId: string, stability: number, dueDay = TODAY): QueueCandidate {
  const state: FsrsState = {
    stability,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    lastDay: "2026-10-10",
    dueDay,
  };
  return { cardId, state, isNew: false };
}

function fresh(cardId: string): QueueCandidate {
  return { cardId, state: undefined, isNew: true };
}

function makeInput(overrides: Partial<QueueInput> = {}): QueueInput {
  return {
    today: TODAY,
    candidates: [],
    newLimit: 5,
    reviewLimit: 20,
    answeredToday: new Set(),
    newAnsweredToday: 0,
    ...overrides,
  };
}

/** `count` due reviews, `r1` the least likely recalled, given in reverse order. */
function dueReviews(count: number): QueueCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    review(`r${String(index + 1)}`, index + 1),
  ).reverse();
}

function newCards(count: number): QueueCandidate[] {
  return Array.from({ length: count }, (_, index) => fresh(`n${String(index + 1)}`));
}

const ids = (cards: readonly { readonly cardId: string }[]): string[] =>
  cards.map(({ cardId }) => cardId);

describe("today's queue with a backlog of reviews", () => {
  // Example 4: 30 due reviews against a review limit of 20 and a new limit of 5.
  const { queue, extra } = todaysQueue(
    makeInput({ candidates: [...dueReviews(30), ...newCards(6)] }),
  );

  it("deals 20 reviews, lowest retrievability first, and no new card", () => {
    expect(ids(queue)).toStrictEqual(
      Array.from({ length: 20 }, (_, index) => `r${String(index + 1)}`),
    );
    expect(queue.every(({ kind }) => kind === "review")).toBe(true);
  });

  it("keeps the other reviews, then the new cards, for extra practice", () => {
    expect(ids(extra)).toStrictEqual([
      ...Array.from({ length: 10 }, (_, index) => `r${String(index + 21)}`),
      ...["n1", "n2", "n3", "n4", "n5", "n6"],
    ]);
  });
});

describe("today's queue with room for new cards", () => {
  // Example 4 again, with 12 due: the new cards fall after every two or three reviews.
  const { queue, extra } = todaysQueue(
    makeInput({ candidates: [...newCards(7), ...dueReviews(12)] }),
  );

  it("deals the 12 reviews and 5 new cards spread evenly among them", () => {
    expect(ids(queue)).toStrictEqual([
      ...["r1", "r2", "n1", "r3", "r4", "n2", "r5", "r6", "r7", "n3"],
      ...["r8", "r9", "n4", "r10", "r11", "r12", "n5"],
    ]);
  });

  it("labels each card by the quota it takes", () => {
    expect(queue.filter(({ kind }) => kind === "new")).toHaveLength(5);
    expect(queue.filter(({ kind }) => kind === "review")).toHaveLength(12);
  });

  it("keeps the new cards past the limit, in the caller's order, for extra", () => {
    expect(extra).toStrictEqual([
      { cardId: "n6", kind: "new" },
      { cardId: "n7", kind: "new" },
    ]);
  });
});

describe("the backlog guard", () => {
  it.each([
    [18, 2],
    [19, 1],
    [20, 0],
  ])("with %p due reviews leaves room for %p new cards", (due, expected) => {
    const { queue } = todaysQueue(
      makeInput({ candidates: [...dueReviews(due), ...newCards(5)] }),
    );
    expect(queue.filter(({ kind }) => kind === "new")).toHaveLength(expected);
  });

  it("counts the new cards answered earlier today against the new limit", () => {
    const { queue } = todaysQueue(
      makeInput({
        candidates: [...dueReviews(4), ...newCards(5)],
        newAnsweredToday: 3,
      }),
    );
    expect(ids(queue.filter(({ kind }) => kind === "new"))).toStrictEqual(["n1", "n2"]);
  });

  it("deals no new card once today's new answers pass the limit", () => {
    const { queue, extra } = todaysQueue(
      makeInput({
        candidates: [...dueReviews(4), ...newCards(2)],
        newAnsweredToday: 6,
      }),
    );
    expect(ids(queue)).toStrictEqual(["r1", "r2", "r3", "r4"]);
    expect(ids(extra)).toStrictEqual(["n1", "n2"]);
  });
});

describe("what today's queue leaves out", () => {
  it("never deals a review not yet due, not even as extra", () => {
    const { queue, extra } = todaysQueue(
      makeInput({
        candidates: [review("due", 5), review("later", 1, "2026-10-21")],
        reviewLimit: 1,
      }),
    );
    expect(ids(queue)).toStrictEqual(["due"]);
    expect(extra).toStrictEqual([]);
  });

  it("deals a review that fell due on an earlier day", () => {
    const { queue } = todaysQueue(
      makeInput({ candidates: [review("overdue", 5, "2026-10-12")] }),
    );
    expect(ids(queue)).toStrictEqual(["overdue"]);
  });

  it("skips every card already answered today, review or new", () => {
    const { queue, extra } = todaysQueue(
      makeInput({
        candidates: [review("r1", 1), review("r2", 2), fresh("n1"), fresh("n2")],
        answeredToday: new Set(["r1", "n1"]),
      }),
    );
    expect(ids(queue)).toStrictEqual(["r2", "n2"]);
    expect(extra).toStrictEqual([]);
  });
});

describe("what counts as new", () => {
  it("deals a card seen before FSRS, with no state, as a review after the scheduled ones", () => {
    const { queue } = todaysQueue(
      makeInput({
        candidates: [
          { cardId: "seen-1", state: undefined, isNew: false },
          review("r1", 3),
          { cardId: "seen-2", state: undefined, isNew: false },
        ],
        newLimit: 0,
      }),
    );
    expect(queue).toStrictEqual([
      { cardId: "r1", kind: "review" },
      { cardId: "seen-1", kind: "review" },
      { cardId: "seen-2", kind: "review" },
    ]);
  });

  it("deals a card the caller calls new in the new quota whatever its state", () => {
    const { queue } = todaysQueue(
      makeInput({ candidates: [{ ...review("again-new", 3), isNew: true }] }),
    );
    expect(queue).toStrictEqual([{ cardId: "again-new", kind: "new" }]);
  });
});

describe("unlimited and zero limits", () => {
  it("deals every due review and every new card when both are unlimited", () => {
    const { queue, extra } = todaysQueue(
      makeInput({
        candidates: [...dueReviews(40), ...newCards(30)],
        newLimit: "unlimited",
        reviewLimit: "unlimited",
      }),
    );
    expect(queue.filter(({ kind }) => kind === "review")).toHaveLength(40);
    expect(queue.filter(({ kind }) => kind === "new")).toHaveLength(30);
    expect(extra).toStrictEqual([]);
  });

  it("deals only new cards, in the caller's order, when nothing is due", () => {
    const { queue } = todaysQueue(makeInput({ candidates: newCards(3) }));
    expect(ids(queue)).toStrictEqual(["n1", "n2", "n3"]);
  });

  it("deals no new card under a new limit of 0", () => {
    const { queue, extra } = todaysQueue(
      makeInput({ candidates: [...dueReviews(2), ...newCards(2)], newLimit: 0 }),
    );
    expect(ids(queue)).toStrictEqual(["r1", "r2"]);
    expect(ids(extra)).toStrictEqual(["n1", "n2"]);
  });

  it("deals nothing from no candidates", () => {
    expect(todaysQueue(makeInput())).toStrictEqual({ queue: [], extra: [] });
  });
});
