/**
 * Every tunable value the web client reads.
 *
 * @remarks
 * `dayBoundaryHour`, `fastRatio`, `newPerDay`, `reviewsPerDay`, `limitSeconds`, `maxFocus`,
 * `defaultGradeKeys` and `defaultHardKey` belong to the practice rules, whose source is
 * `packages/domain`'s `TUNING`; `talkTurns` is the talk's, from its `TALK_TUNING`;
 * `maxRoundAnswers` is the contract's `MAX_ROUND_ANSWERS`. The web client imports no
 * workspace package, so they are written out here and `tests/web-tuning.test.ts` holds
 * them to their sources. The rest — the re-ask gaps, the feedback hold, the key lock,
 * the skeleton delay, the toast, voice input's silence and no-input waits — are the
 * client's own, kept in the same object because they are meant to be tuned too.
 */
export const TUNING = {
  /** The practice day starts at this hour; the home screen names it as the deadline. */
  dayBoundaryHour: 4,
  /** A correct answer flipped within this share of its card's pace is "fast". */
  fastRatio: 0.5,
  /** New cards a day may bring, as the settings offer them. */
  newPerDay: [0, 3, 5, 10, 15],
  /** Reviews a day may bring, as the settings offer them; `null` is no limit, always last. */
  reviewsPerDay: [10, 20, 30, 50, null],
  /** The per-card time limits the settings offer, in seconds, in the order they are shown. */
  limitSeconds: [15, 20, 30, 45, 60],
  /** At most this many focus subtopics are kept. */
  maxFocus: 2,
  /** The drill's grade keys until the learner chooses others, as `KeyboardEvent.code`. */
  defaultGradeKeys: { ok: "ArrowRight", ng: "ArrowLeft" },
  /** △'s key beside the default pair: the first of the domain's `hardKeys`. */
  defaultHardKey: "Digit2",
  /** The most answers one request carries; a round's unrecorded answers go in batches of this many. */
  maxRoundAnswers: 60,
  /**
   * In-session re-asks: how many other cards are shown before a card comes
   * back — after × (`again`), after △ (`hard`), and after a card new to the
   * learner is first graded ○ (`newGood`) — and the most re-asks of one card.
   */
  reAsk: { again: 4, hard: 8, newGood: 12, max: 10 },
  /** Turns in a talk; the last one's reply closes the scene. */
  talkTurns: 6,
  feedbackMaxMs: 320,
  keyLockAfterFlipMs: 150,
  skeletonDelayMs: 300,
  toastMs: 4000,
  /** A talk's voice input sends this long after the last word heard, with nothing new. */
  speechSilenceMs: 2000,
  /** A talk's voice input stops quietly when nothing is heard this long after it starts listening. */
  speechNoInputMs: 10000,
} as const;

/** Whether a flip came within the "fast" share of its card's pace, whatever the limit. */
export function isFast(elapsedMs: number, paceMs: number): boolean {
  return elapsedMs <= paceMs * TUNING.fastRatio;
}
