/** The overshoot ease the celebration's pops share. */
const OVERSHOOT = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** The drill's entrance motions; the durations are `designing-ui`'s behavior table. */
const MOTIONS = {
  /** A back's content rising into place after the flip. */
  rise: {
    keyframes: [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    options: { duration: 180, easing: "ease-out" },
  },
  /** The next card fading in. */
  fade: { keyframes: [{ opacity: 0 }, { opacity: 1 }], options: { duration: 120 } },
  /** The combo figure growing by one. */
  pulse: {
    keyframes: [
      { transform: "scale(1)" },
      { transform: "scale(1.15)" },
      { transform: "scale(1)" },
    ],
    options: { duration: 120 },
  },
  /** The "fast" chip rising as it appears. */
  chip: {
    keyframes: [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    options: { duration: 320, easing: "ease-out" },
  },
  /** A milestone card appearing on the summary; several are staggered by `delay`. */
  title: {
    keyframes: [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    options: { duration: 200, easing: "ease-out" },
  },
  /** The grown streak figure popping in. */
  pop: {
    keyframes: [
      { transform: "scale(0.6)" },
      { transform: "scale(1.2)", offset: 0.6 },
      { transform: "scale(1)" },
    ],
    options: { duration: 600, easing: OVERSHOOT },
  },
  /** The flame beside a grown streak, popping a beat longer than the figure. */
  flame: {
    keyframes: [
      { transform: "scale(0.3) rotate(-12deg)" },
      { transform: "scale(1.25) rotate(6deg)", offset: 0.55 },
      { transform: "scale(1) rotate(0deg)" },
    ],
    options: { duration: 800, easing: OVERSHOOT },
  },
  /** Today's week disc checking in. */
  check: {
    keyframes: [
      { transform: "scaleX(0.2)", opacity: 0 },
      { transform: "scaleX(1.08)", opacity: 1, offset: 0.7 },
      { transform: "scaleX(1)", opacity: 1 },
    ],
    options: { duration: 500, easing: OVERSHOOT },
  },
  /** "+N pt" popping into its chip. */
  points: {
    keyframes: [
      { opacity: 0, transform: "scale(0.5)" },
      { opacity: 1, transform: "scale(1)" },
    ],
    options: { duration: 500, easing: OVERSHOOT },
  },
} as const satisfies Record<
  string,
  { keyframes: readonly Keyframe[]; options: KeyframeAnimationOptions }
>;

export type MotionName = keyof typeof MOTIONS;

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Plays `name` on `element` through the Web Animations API. Reduced motion
 * plays nothing, which is the instant form every one of these motions has.
 */
export function playMotion(
  element: {
    animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => unknown;
  } | null,
  name: MotionName,
  delay = 0,
): void {
  if (element?.animate === undefined || prefersReducedMotion()) return;
  const motion = MOTIONS[name];
  element.animate(
    [...motion.keyframes],
    delay > 0 ? { ...motion.options, delay, fill: "backwards" } : { ...motion.options },
  );
}
