/**
 * Every tunable value the web client reads.
 *
 * @remarks
 * `dayBoundaryHour`, `fastRatio`, `dailySizes` and `maxFocus` belong to the
 * practice rules, whose source is `packages/domain`'s `TUNING`. The web client
 * imports no workspace package, so they are written out here and
 * `tests/web-tuning.test.ts` holds them to the domain's. The rest — the feedback hold, the key lock, the
 * skeleton delay, the toast — are the client's own, kept in the same object
 * because they are meant to be tuned too.
 */
export const TUNING = {
  /** The practice day starts at this hour; the home screen names it as the deadline. */
  dayBoundaryHour: 4,
  /** A correct answer flipped within this share of the limit is "fast". */
  fastRatio: 0.5,
  /** The daily sizes the settings offer, in the order they are shown. */
  dailySizes: [5, 10, 15, 20, 30],
  /** At most this many focus subtopics are kept. */
  maxFocus: 2,
  feedbackMaxMs: 320,
  keyLockAfterFlipMs: 150,
  skeletonDelayMs: 300,
  toastMs: 4000,
} as const;

/** Whether a flip came within the "fast" share of the limit. */
export function isFast(elapsedMs: number, limitMs: number): boolean {
  return elapsedMs <= limitMs * TUNING.fastRatio;
}
