import { describe, expect, it } from "vitest";

import {
  dealVocab,
  decideSettings,
  decideVocabAnswers,
  DEFAULT_SETTINGS,
  VOCAB_TUNING,
  vocabFigures,
  withDefaults,
  type FsrsState,
  type VocabAnswer,
  type VocabProgress,
  type VocabReview,
  type VocabSession,
} from "@instant-composition/domain";

type VocabState = Parameters<typeof dealVocab>[0];
type Card = VocabState["cards"][number];

const TODAY = "2026-09-22";
const CATEGORIES = VOCAB_TUNING.categories;

/** Forty cards as the starter cards are laid out: ten per category, two at each level 3–7. */
const CARDS: Card[] = CATEGORIES.flatMap((category) =>
  [3, 4, 5, 6, 7].flatMap((level) =>
    [0, 1].map((index) => ({
      id: `${category}-${String(level)}-${String(index)}`,
      category,
      level,
    })),
  ),
);

function scheduled(overrides: Partial<FsrsState> = {}): FsrsState {
  return {
    stability: 10,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    lastDay: "2026-09-12",
    dueDay: TODAY,
    ...overrides,
  };
}

function progressOf(
  cardId: string,
  overrides: Partial<VocabProgress> = {},
): [string, VocabProgress] {
  return [
    cardId,
    {
      cardId,
      source: { kind: "catalog" },
      state: scheduled(),
      firstDay: "2026-09-01",
      ...overrides,
    },
  ];
}

function makeState(overrides: Partial<VocabState> = {}): VocabState {
  return {
    today: TODAY,
    level: 4,
    cards: CARDS,
    progress: new Map(),
    newPerDay: 10,
    reviewsPerDay: 100,
    ...overrides,
  };
}

const ids = (cards: readonly { readonly cardId: string }[]): string[] =>
  cards.map(({ cardId }) => cardId);

describe("today's vocabulary queue for a learner with nothing answered", () => {
  // Example 1: level 4, the forty cards and the defaults.
  const state = makeState();

  it("deals ten new cards from level 3 up, the categories taking turns", () => {
    expect(ids(dealVocab(state, "today", null))).toStrictEqual([
      "word-3-0",
      "idiom-3-0",
      "phrasal-verb-3-0",
      "phrase-3-0",
      "word-3-1",
      "idiom-3-1",
      "phrasal-verb-3-1",
      "phrase-3-1",
      "word-4-0",
      "idiom-4-0",
    ]);
  });

  it("shows 10 new, no review and about 2 minutes, by category 3, 3, 2 and 2", () => {
    const figures = vocabFigures(state);
    expect(figures).toMatchObject({
      due: 0,
      fresh: 10,
      minutes: 2,
      weak: 0,
      tomorrow: 0,
    });
    expect(figures.categories).toStrictEqual(
      [3, 3, 2, 2].map((fresh, index) => ({
        category: CATEGORIES[index],
        due: 0,
        fresh,
        learning: 0,
        total: 10,
      })),
    );
  });

  it("deals a category's share of today's queue alone", () => {
    expect(ids(dealVocab(state, "today", "phrase"))).toStrictEqual([
      "phrase-3-0",
      "phrase-3-1",
    ]);
  });
});

describe("the order new cards come in", () => {
  it("goes past the band to the next level up, then below the band, highest first", () => {
    const low = dealVocab(makeState({ level: 1, newPerDay: 30 }), "today", null);
    expect(low.slice(8, 16).every(({ cardId }) => cardId.includes("-4-"))).toBe(true);
    expect(low).toHaveLength(30);

    const high = dealVocab(makeState({ level: 7, newPerDay: 30 }), "today", null);
    const levels = high.map(({ cardId }) => cardId.split("-").at(-2));
    expect(levels).toStrictEqual([
      ...Array.from({ length: 16 }, (_, index) => (index < 8 ? "6" : "7")),
      ...Array.from({ length: 8 }, () => "5"),
      ...Array.from({ length: 6 }, () => "4"),
    ]);
  });

  it("deals a learner above every card the catalog holds from the highest level down", () => {
    const deal = dealVocab(makeState({ level: 9 }), "today", null);
    expect(ids(deal)).toStrictEqual([
      "word-7-0",
      "idiom-7-0",
      "phrasal-verb-7-0",
      "phrase-7-0",
      "word-7-1",
      "idiom-7-1",
      "phrasal-verb-7-1",
      "phrase-7-1",
      "word-6-0",
      "idiom-6-0",
    ]);
    expect(vocabFigures(makeState({ level: 10 }))).toMatchObject({ due: 0, fresh: 10 });
  });

  it("deals a weak new card first, from a talk, whatever its level", () => {
    const progress = new Map([
      progressOf("phrase-7-1", {
        source: { kind: "talk", talkId: "t1", turn: 2 },
        state: null,
        firstDay: null,
      }),
    ]);
    expect(ids(dealVocab(makeState({ progress }), "today", null))[0]).toBe(
      "phrase-7-1",
    );
  });
});

describe("the daily limits", () => {
  it("count the new cards introduced today against the new limit", () => {
    const progress = new Map(
      ["word-3-0", "idiom-3-0", "phrasal-verb-3-0"].map((id) =>
        progressOf(id, {
          state: scheduled({ lastDay: TODAY, dueDay: "2026-09-25", reps: 1 }),
          firstDay: TODAY,
        }),
      ),
    );
    expect(vocabFigures(makeState({ progress }))).toMatchObject({ due: 0, fresh: 7 });
  });

  it("count the reviews answered today against the review limit, and hold new cards back", () => {
    // Eighty cards: 45 reviewed today, 25 due, and 10 never answered.
    const cards: Card[] = Array.from({ length: 80 }, (_, index) => ({
      id: `card-${String(index).padStart(2, "0")}`,
      category: CATEGORIES[index % 4] ?? "word",
      level: 4,
    }));
    const answered = cards
      .slice(0, 45)
      .map(({ id }) =>
        progressOf(id, { state: scheduled({ lastDay: TODAY, dueDay: "2026-09-30" }) }),
      );
    const due = cards.slice(45, 70).map(({ id }) => progressOf(id));
    const state = makeState({
      cards,
      progress: new Map([...answered, ...due]),
      reviewsPerDay: 50,
    });

    expect(vocabFigures(state)).toMatchObject({ due: 5, fresh: 0 });
    expect(dealVocab(state, "extra", null)).toHaveLength(10);
    expect(vocabFigures({ ...state, reviewsPerDay: null })).toMatchObject({
      due: 25,
      fresh: 10,
    });
  });

  it("deal the reviews and new cards past them as extra, ten at most", () => {
    const due = CARDS.slice(0, 15).map(({ id }) => progressOf(id));
    const state = makeState({
      progress: new Map(due),
      reviewsPerDay: 50,
      newPerDay: 5,
    });
    expect(vocabFigures(state)).toMatchObject({ due: 15, fresh: 5 });
    const extra = dealVocab(state, "extra", null);
    expect(extra).toHaveLength(VOCAB_TUNING.extraSize);
    expect(extra.every(({ kind }) => kind === "new")).toBe(true);
  });
});

describe("the weak cards", () => {
  // Example 3: eight lapses at a stability of 4, then 21.
  it.each([
    [4, 1],
    [20.9, 1],
    [21, 0],
  ])("count a card with 8 lapses at a stability of %d as %d", (stability, weak) => {
    const progress = new Map([
      progressOf("word-5-0", {
        state: scheduled({ lapses: 8, stability, dueDay: "2026-10-30" }),
      }),
    ]);
    expect(vocabFigures(makeState({ progress })).weak).toBe(weak);
  });

  it("leave out a card with 7 lapses, and one answered today", () => {
    const progress = new Map([
      progressOf("word-5-0", { state: scheduled({ lapses: 7, stability: 4 }) }),
      progressOf("word-5-1", {
        state: scheduled({ lapses: 9, stability: 4, lastDay: TODAY }),
      }),
    ]);
    expect(vocabFigures(makeState({ progress })).weak).toBe(0);
    expect(dealVocab(makeState({ progress }), "weak", null)).toStrictEqual([]);
  });

  it("deal twenty of twenty-five weak cards, the least likely recalled first, outside the limits", () => {
    // Example 4: the weak session. A higher stability is recalled better.
    const progress = new Map(
      CARDS.slice(0, 25).map(({ id }, index) =>
        progressOf(id, {
          state: scheduled({
            lapses: 8,
            stability: 1 + index * 0.5,
            dueDay: "2026-10-30",
          }),
        }),
      ),
    );
    const state = makeState({ progress, reviewsPerDay: 50, newPerDay: 0 });
    const weak = dealVocab(state, "weak", null);
    expect(ids(weak)).toStrictEqual(CARDS.slice(0, 20).map(({ id }) => id));
    expect(weak.every(({ kind }) => kind === "review")).toBe(true);
    expect(vocabFigures(state).weak).toBe(25);
  });
});

function session(overrides: Partial<VocabSession> = {}): VocabSession {
  return {
    id: "s1",
    kind: "today",
    category: null,
    day: TODAY,
    deck: ["word-3-0", "idiom-3-0"],
    startedAt: 1_000,
    finishedAt: null,
    tomorrow: null,
    ...overrides,
  };
}

function answer(overrides: Partial<VocabAnswer> = {}): VocabAnswer {
  return {
    id: "a1",
    cardId: "word-3-0",
    pass: "first",
    grade: "good",
    elapsedMs: 3_000,
    answeredAt: 2_000,
    ...overrides,
  };
}

const SNAPSHOTS = new Map(
  CARDS.map((card): [string, VocabReview["snapshot"]] => [
    card.id,
    {
      headword: card.id,
      meaning: `${card.id}の意味`,
      category: card.category,
      level: card.level,
    },
  ]),
);

function decide(
  answers: readonly VocabAnswer[],
  options: {
    readonly session?: VocabSession;
    readonly progress?: ReadonlyMap<string, VocabProgress>;
    readonly recorded?: ReadonlySet<string>;
  } = {},
) {
  return decideVocabAnswers(
    {
      session: options.session ?? session(),
      progress: options.progress ?? new Map(),
      recorded: options.recorded ?? new Set(),
    },
    answers,
    SNAPSHOTS,
    5_000,
  );
}

describe("a vocabulary session's answers", () => {
  it("schedule a new card graded good three days on, and introduce it today", () => {
    // Example 2.
    const decided = decide([answer()]);
    if (!decided.ok) throw new Error(decided.error.code);
    expect(decided.value.moved).toMatchObject([
      {
        cardId: "word-3-0",
        source: { kind: "catalog" },
        state: { reps: 1, lapses: 0, lastDay: TODAY, dueDay: "2026-09-25" },
        firstDay: TODAY,
      },
    ]);
    expect(decided.value.entries).toMatchObject([
      { id: "a1", sessionId: "s1", day: TODAY, before: null, grade: "good" },
    ]);
  });

  it("move a card only on its first answer of the day; a re-ask is logged unchanged", () => {
    const decided = decide([
      answer({ grade: "again" }),
      answer({ id: "a2", pass: "retry", grade: "good", answeredAt: 3_000 }),
    ]);
    if (!decided.ok) throw new Error(decided.error.code);
    const [first, reask] = decided.value.entries;
    expect(first?.after?.dueDay).toBe("2026-09-23");
    expect(reask?.before).toStrictEqual(first?.after);
    expect(reask?.after).toStrictEqual(reask?.before);
    expect(decided.value.moved.map(({ state }) => state)).toStrictEqual([first?.after]);
  });

  it("leave a card answered earlier that day where it is, in another session too", () => {
    const answered = scheduled({ lastDay: TODAY, dueDay: "2026-09-25" });
    const decided = decide([answer()], {
      progress: new Map([progressOf("word-3-0", { state: answered })]),
    });
    expect(decided.ok && decided.value.moved).toStrictEqual([]);
    expect(decided.ok && decided.value.entries[0]?.after).toStrictEqual(answered);
  });

  it("skip an id already held, and one repeated in the batch", () => {
    const decided = decide([answer(), answer({ id: "a2" }), answer({ id: "a2" })], {
      recorded: new Set(["a1"]),
    });
    expect(decided.ok && decided.value.entries.map(({ id }) => id)).toStrictEqual([
      "a2",
    ]);
  });

  it("hold a client's time between the session's start and the server's", () => {
    const decided = decide([
      answer({ answeredAt: 0 }),
      answer({ id: "a2", cardId: "idiom-3-0", answeredAt: 9_000 }),
    ]);
    expect(decided.ok && decided.value.entries.map((e) => e.answeredAt)).toStrictEqual([
      1_000, 5_000,
    ]);
  });

  it("refuse a card the session did not deal", () => {
    expect(decide([answer({ cardId: "word-7-1" })])).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });

  it("refuse a new id once the session finished, and take a resent one", () => {
    const finished = session({ finishedAt: 4_000, tomorrow: 0 });
    expect(decide([answer({ id: "new" })], { session: finished })).toStrictEqual({
      ok: false,
      error: { code: "ERR_SESSION_CLOSED" },
    });
    expect(
      decide([answer()], { session: finished, recorded: new Set(["a1"]) }),
    ).toStrictEqual({ ok: true, value: { entries: [], moved: [] } });
  });
});

describe("the vocabulary limits in the settings", () => {
  const current = { ...DEFAULT_SETTINGS, topics: ["work"] };
  const taxonomy = [{ id: "work", name: "仕事", subtopics: [] }];

  it("read as 10 new and 100 reviews until chosen", () => {
    expect(withDefaults(current)).toMatchObject({
      vocabNewPerDay: 10,
      vocabReviewsPerDay: 100,
    });
  });

  it.each([
    [{ vocabNewPerDay: 0 }],
    [{ vocabNewPerDay: 30 }],
    [{ vocabReviewsPerDay: 200 }],
    [{ vocabReviewsPerDay: null }],
  ] as const)("take %j", (patch) => {
    const decided = decideSettings(current, patch, taxonomy);
    expect(decided.ok && decided.value.settings).toStrictEqual({
      ...current,
      ...patch,
    });
  });

  it("keep no limit when it is chosen, through a later change of another field", () => {
    const decided = decideSettings(
      { ...current, vocabReviewsPerDay: null },
      { sound: false },
      taxonomy,
    );
    expect(decided.ok && decided.value.settings.vocabReviewsPerDay).toBeNull();
  });

  it.each([[{ vocabNewPerDay: 7 }], [{ vocabReviewsPerDay: 150 }]])(
    "refuse %j, which the settings do not offer",
    (patch) => {
      expect(
        decideSettings(
          current,
          patch as Parameters<typeof decideSettings>[1],
          taxonomy,
        ),
      ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    },
  );
});
