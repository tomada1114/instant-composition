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
  estimateSecondsPerCard: 30,
  /** Fewer cards than this and no round is built. */
  minDeckSize: 5,
  placementSize: 10,
  dailySizes: [5, 10, 15, 20, 30],
  defaultDailySize: 10,
  /** The per-card time limits the settings offer, in seconds. */
  limitSeconds: [15, 20, 30, 45, 60],
  defaultLimitSeconds: 30,
  maxFocus: 2,
  mix: {
    reviewShareMax: 0.6,
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
  /** Days until the next review, indexed by box 0..5. */
  leitnerIntervalsDays: [1, 2, 4, 7, 14, 30],
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

/** A milestone series: the listed values, then every `step` past the last one. */
export interface MilestoneSeries {
  readonly fixed: readonly number[];
  readonly step: number;
}
