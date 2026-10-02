import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  addDays,
  dayDiff,
  previewGrades,
  retrievability,
  scheduleCard,
  type FsrsGrade,
  type FsrsState,
  type GradePreview,
} from "@instant-composition/domain";

// The golden vectors were computed with ts-fsrs 5.4.2 outside this repository;
// the fixture's header holds the options, the inputs and the script that wrote
// it. ts-fsrs is in no manifest here.
interface GoldenStep {
  readonly day: string;
  readonly grade: FsrsGrade;
  readonly preview: GradePreview;
}

interface Golden {
  readonly header: { readonly generator: string };
  readonly retrievability: readonly {
    readonly stability: number;
    readonly elapsedDays: number;
    readonly retrievability: number;
  }[];
  readonly histories: readonly {
    readonly cardId: string;
    readonly steps: GoldenStep[];
  }[];
}

function isGolden(value: unknown): value is Golden {
  return (
    typeof value === "object" &&
    value !== null &&
    "histories" in value &&
    Array.isArray(value.histories) &&
    "retrievability" in value &&
    Array.isArray(value.retrievability)
  );
}

function loadGolden(): Golden {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("fixtures/fsrs-golden.json", import.meta.url), "utf8"),
  );
  if (!isGolden(parsed)) {
    throw new TypeError("tests/fixtures/fsrs-golden.json is not a golden-vector file");
  }
  return parsed;
}

const golden = loadGolden();

/** A state a card graded good on 2026-10-01 and again on its due day is left in. */
function reviewedTwice(cardId: string): FsrsState {
  const first = scheduleCard(undefined, "good", "2026-10-01", cardId).state;
  return scheduleCard(first, "good", first.dueDay, cardId).state;
}

describe("the golden vectors from ts-fsrs 5.4.2", () => {
  it("come from the version the schedule follows", () => {
    expect(golden.header.generator).toContain("v5.4.2");
  });

  it("cover at least forty cards' histories", () => {
    expect(golden.histories.length).toBeGreaterThanOrEqual(40);
  });

  it.each(golden.histories.map((history) => [history.cardId, history] as const))(
    "reproduces every grade's state and interval along %s's history",
    (cardId, history) => {
      let state: FsrsState | undefined;
      for (const step of history.steps) {
        const preview = previewGrades(state, step.day, cardId);
        expect(preview).toStrictEqual(step.preview);
        state = preview[step.grade].state;
      }
    },
  );

  it.each(
    golden.retrievability.map(
      (row) => [row.stability, row.elapsedDays, row.retrievability] as const,
    ),
  )("gives stability %p after %p days a retrievability of %p", (stability, days, r) => {
    const lastDay = "2026-10-01";
    expect(retrievability({ stability, lastDay }, addDays(lastDay, days))).toBe(r);
  });
});

describe("a new card's first grade", () => {
  // Example 1: S0 is w2 for good, and the grades' intervals are 1, 2 and 3 days.
  it("sets stability 2.3065 and a due day three days on for good", () => {
    const scheduled = scheduleCard(undefined, "good", "2026-10-01", "card-1");
    expect(scheduled.state.stability).toBe(2.3065);
    expect(scheduled.state.dueDay).toBe("2026-10-04");
    expect(scheduled.intervalDays).toBe(3);
  });

  it("gives again one day and hard two", () => {
    const preview = previewGrades(undefined, "2026-10-01", "card-1");
    expect([preview.again.intervalDays, preview.hard.intervalDays]).toStrictEqual([
      1, 2,
    ]);
  });

  it("starts the card with one rep, no lapse and today as its last day", () => {
    const { state } = scheduleCard(undefined, "again", "2026-10-01", "card-1");
    expect(state).toMatchObject({
      reps: 1,
      lapses: 0,
      lastDay: "2026-10-01",
      dueDay: "2026-10-02",
    });
  });
});

describe("the fuzz", () => {
  const cardIds = Array.from({ length: 10 }, (_, index) => `card-${String(index + 1)}`);

  // Example 2: ts-fsrs's card-id seed spreads these over 12–16 days.
  it("spreads ten cards graded good twice over the days ts-fsrs picks", () => {
    const intervals = cardIds.map((cardId) => {
      const first = scheduleCard(undefined, "good", "2026-10-01", cardId).state;
      return scheduleCard(first, "good", "2026-10-04", cardId).intervalDays;
    });
    expect(intervals).toStrictEqual([12, 14, 16, 12, 13, 13, 16, 13, 14, 15]);
  });

  it("gives the same day for the same card, grade and day", () => {
    expect(reviewedTwice("card-3")).toStrictEqual(reviewedTwice("card-3"));
  });
});

describe("a review graded again", () => {
  // Example 3: a review with stability 13.8, forgotten on its due day.
  const review: FsrsState = {
    stability: 13.8,
    difficulty: 2.11121424,
    reps: 2,
    lapses: 0,
    lastDay: "2026-10-04",
    dueDay: "2026-10-18",
  };
  const lapsed = scheduleCard(review, "again", review.dueDay, "card-1");

  it("counts a lapse and stays a review with one more rep", () => {
    expect(lapsed.state).toMatchObject({ reps: 3, lapses: 1, lastDay: "2026-10-18" });
  });

  it("takes its interval from the post-lapse stability, at least a day", () => {
    // w11 · D^−w12 · ((S + 1)^w13 − 1) · e^(w14·(1 − R)) at R ≈ 0.9 is about 1.72.
    expect(lapsed.state.stability).toBeCloseTo(1.72, 1);
    expect(lapsed.intervalDays).toBe(2);
    expect(dayDiff(lapsed.state.lastDay, lapsed.state.dueDay)).toBe(2);
  });
});

describe("the three grades' intervals", () => {
  it.each(golden.histories.map((history) => [history.cardId, history] as const))(
    "rise strictly from again to hard to good along %s's history",
    (cardId, history) => {
      for (const step of history.steps) {
        const { again, hard, good } = step.preview;
        expect(hard.intervalDays, `${cardId} on ${step.day}`).toBeGreaterThan(
          again.intervalDays,
        );
        expect(good.intervalDays, `${cardId} on ${step.day}`).toBeGreaterThan(
          hard.intervalDays,
        );
      }
    },
  );
});

describe("retrievability", () => {
  // Example 5: R is 0.9 exactly when the days since the review equal S.
  it("is 0.9 for stability 10 ten days after the last review", () => {
    expect(retrievability({ stability: 10, lastDay: "2026-10-01" }, "2026-10-11")).toBe(
      0.9,
    );
  });

  it("is 1 on the day of the last review", () => {
    expect(retrievability({ stability: 10, lastDay: "2026-10-01" }, "2026-10-01")).toBe(
      1,
    );
  });

  it("reads a day before the last review as no wait at all", () => {
    expect(retrievability({ stability: 10, lastDay: "2026-10-05" }, "2026-10-01")).toBe(
      1,
    );
  });
});

describe("a review answered before its last day", () => {
  it("is scheduled as if answered on that same day", () => {
    const state = reviewedTwice("card-1");
    const before = previewGrades(state, addDays(state.lastDay, -1), "card-1");
    const sameDay = previewGrades(state, state.lastDay, "card-1");
    expect(before.good.state.stability).toBe(sameDay.good.state.stability);
    expect(before.good.intervalDays).toBe(sameDay.good.intervalDays);
  });
});
