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
