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
  /** `ceil(base + words * perWord)`, clamped to `min..max`. */
  timer: { baseSeconds: 4, secondsPerWord: 0.5, minSeconds: 6, maxSeconds: 20 },
  /** A correct answer flipped within this share of the limit is "fast". */
  fastRatio: 0.5,
  estimateSecondsPerCard: 30,
  /** Fewer cards than this and no round is built. */
  minDeckSize: 5,
  placementSize: 10,
  dailySizes: [5, 10, 15, 20, 30],
  defaultDailySize: 10,
  maxFocus: 2,
  mix: {
    reviewShareMax: 0.6,
    focusShareOfNew: 0.5,
    levelShare: { same: 0.6, below: 0.2, above: 0.2 },
  },
  /** Days until the next review, indexed by box 0..5. */
  leitnerIntervalsDays: [1, 2, 4, 7, 14, 30],
  difficulty: {
    window: 30,
    minAnswers: 20,
    upOkRate: 0.85,
    upFastRate: 0.5,
    downOkRate: 0.6,
    placementSolidRatio: 0.75,
  },
  reachMilestones: { fixed: [10, 25, 50, 100], step: 100 },
  streakMilestones: { fixed: [7, 14, 30, 60, 100, 200, 365], step: 100 },
  points: { perCard: 1, portionBonus: 10 },
  growth: { fasterThresholdMs: 100 },
  summaryListRows: 3,
  feedbackMaxMs: 320,
  keyLockAfterFlipMs: 150,
  skeletonDelayMs: 300,
  toastMs: 4000,
} as const;

/** A milestone series: the listed values, then every `step` past the last one. */
export interface MilestoneSeries {
  readonly fixed: readonly number[];
  readonly step: number;
}
