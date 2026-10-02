/**
 * Every tunable value the web client reads.
 *
 * @remarks
 * Practice and talk rule values arrive through API responses. Only the web
 * grade-key defaults and the contract's batch bound remain mirrored here, held
 * to their sources by `tests/web-tuning.test.ts`. The remaining values belong
 * to browser interaction: re-asks, feedback, key locks, loading, notices and voice.
 */
export const TUNING = {
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
  feedbackMaxMs: 320,
  keyLockAfterFlipMs: 150,
  skeletonDelayMs: 300,
  toastMs: 4000,
  /** A talk's voice input sends this long after the last word heard, with nothing new. */
  speechSilenceMs: 2000,
  /** A talk's voice input stops quietly when nothing is heard this long after it starts listening. */
  speechNoInputMs: 10000,
} as const;
