/**
 * Every tunable value the practice rules read.
 *
 * @remarks
 * These are starting values meant to be adjusted while the app is in use, so
 * they live in this one object and nowhere else: a rule module reads them from
 * here, and a test builds its expectation from here or from a worked example.
 */
export const TUNING = {
  dayBoundaryHour: 4,
  /**
   * A card's pace, the yardstick "fast" is judged by: `ceil(base + words *
   * perWord)` seconds, clamped to `min..max`. It no longer decides when the
   * timer runs out; the learner's chosen limit does.
   */
  pace: { baseSeconds: 4, secondsPerWord: 0.5, minSeconds: 6, maxSeconds: 20 },
  /** A correct answer flipped within this share of its card's pace is "fast". */
  fastRatio: 0.5,
  /**
   * Fewer cards than this and no portion is dealt; today's queue under it is
   * topped up with cards not yet due.
   */
  minDeckSize: 5,
  placementSize: 10,
  /** The daily sizes a client may still show and set; none of them sizes a deal. */
  dailySizes: [5, 10, 15, 20, 30],
  defaultDailySize: 10,
  /** New cards a day may bring, as the settings offer them. */
  newPerDay: [0, 3, 5, 10, 15],
  defaultNewPerDay: 5,
  /** Reviews a day may bring; `null` is no limit. */
  reviewsPerDay: [10, 20, 30, 50, null],
  defaultReviewsPerDay: 20,
  /** Cards one extra round deals past today's queue: "one more 5". */
  extraSize: 5,
  /** The per-card time limits the settings offer, in seconds. */
  limitSeconds: [15, 20, 30, 45, 60],
  defaultLimitSeconds: 30,
  /** The drill's grade keys until the learner chooses others, as `KeyboardEvent.code`. */
  defaultGradeKeys: { ok: "ArrowRight", ng: "ArrowLeft" },
  /** △'s key when none was chosen: the first of these the other two keys leave free. */
  hardKeys: ["Digit2", "KeyS", "ArrowDown"],
  maxFocus: 2,
  /** How a deal's new cards are chosen; how many comes from the daily limits. */
  mix: {
    focusShareOfNew: 0.5,
    /** Taken after the focus share, from the learner's weak grammar concepts. */
    weakShareOfNew: 0.3,
    /**
     * A deck's new cards by level, planned over all of them (`levelPlan`): the
     * level, one below, one above, and a probe `probeStep` above, the only new
     * cards that show a level past the next. From `offLevelFrom` new cards on,
     * at least one goes a level up and one to the probe, so a deck mostly of
     * reviews still brings the answers the level climbs on.
     */
    levelShare: { same: 0.5, below: 0.2, above: 0.2, probe: 0.1 },
    probeStep: 2,
    offLevelFrom: { above: 2, probe: 3 },
  },
  /**
   * FSRS-6's long-term schedule (`fsrs.ts`): ts-fsrs 5.4.2's 21 default
   * weights, the recall probability an interval aims at, and the longest
   * interval it sets before the grades are spread apart.
   */
  fsrs: {
    weights: [
      0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
      0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
      0.1542,
    ],
    desiredRetention: 0.9,
    maximumIntervalDays: 365,
  },
  /**
   * The level the answers show, judged card level by card level over the
   * newest `window` first-pass answers, each card by its latest: a level is
   * cleared on at least `minPerLevel.clear` cards at `upOkRate` correct with
   * `upFastRate` of those fast, and failed on at least `minPerLevel.fail` under
   * `downOkRate` correct. A close moves at most one step past what the answers
   * before it showed. See `suggestLevel` and `adjustLevel`.
   */
  difficulty: {
    window: 30,
    minPerLevel: { clear: 3, fail: 4 },
    upOkRate: 0.85,
    upFastRate: 0.5,
    downOkRate: 0.6,
    placementSolidRatio: 0.75,
  },
  reachMilestones: { fixed: [10, 25, 50, 100], step: 100 },
  streakMilestones: { fixed: [7, 14, 30, 60, 100, 200, 365], step: 100 },
  points: { perCard: 1, portionBonus: 10 },
  growth: { fasterThresholdMs: 100 },
  /**
   * A grammar concept or subtopic is weak at `minSeen` shown items given a first
   * pass and a rate of at least `minRate`, where the rate is
   * `(misses + prior.misses) / (seen + prior.seen)` and a miss is an item whose
   * latest first pass was `ng` or a timeout. The `top` weakest of each are kept.
   */
  weakness: { minSeen: 3, minRate: 0.4, prior: { misses: 1, seen: 3 }, top: 2 },
} as const;

/** Every tunable value the talk rules and commands read, kept apart from the drill's. */
export const TALK_TUNING = {
  /** Turns in a talk; the last one's reply closes the scene. */
  turns: 6,
  /** The most characters the learner's Japanese or English may hold, each. */
  maxChars: 300,
  /** How long an open talk lives before it reads as absent and the table's TTL deletes it. */
  expiresAfterMs: 86_400_000,
  /** The bound on each model call. */
  modelTimeoutMs: 12_000,
  /** The share of scenes about the learner themselves; the rest are an errand or a small trouble. */
  selfShare: 2 / 3,
  /** The most card candidates a talk's end offers: at most one per corrected turn. */
  maxCandidates: 6,
} as const;

/**
 * Every tunable value the vocabulary rules read, kept apart from the drill's.
 * The categories are in the order new cards take turns in.
 */
export const VOCAB_TUNING = {
  categories: ["word", "idiom", "phrasal-verb", "phrase"],
  /** New cards a day may bring, as the settings offer them. */
  newPerDay: [0, 5, 10, 15, 20, 30],
  defaultNewPerDay: 10,
  /** Reviews a day may bring; `null` is no limit. */
  reviewsPerDay: [50, 100, 200, null],
  defaultReviewsPerDay: 100,
  /** What one card takes, for the hub's estimate of minutes. */
  secondsPerCard: 10,
  /** Cards one extra session deals past today's queue. */
  extraSize: 10,
  /**
   * A card is weak when it came from a talk or has lapsed `lapses` times,
   * until its stability reaches `exitStabilityDays`; a weak session deals at
   * most `sessionSize`.
   */
  weak: { lapses: 8, exitStabilityDays: 21, sessionSize: 20 },
  /**
   * The limits a card's text keeps: the lint's `VOCAB_LIMITS` in
   * `scripts/cards/vocab-rules.mjs`, which a personal card the model writes
   * meets too. Words count a line, a dialogue's `A:` uncounted.
   */
  card: {
    headwordWords: { min: 1, max: 6 },
    definitionWords: 15,
    exampleWords: 15,
    example2Words: 15,
    meaningChars: 20,
  },
} as const;

/** A milestone series: the listed values, then every `step` past the last one. */
export interface MilestoneSeries {
  readonly fixed: readonly number[];
  readonly step: number;
}
