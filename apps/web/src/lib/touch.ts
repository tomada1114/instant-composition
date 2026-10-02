/** A touch-only device: a phone, whose only keyboard is the software one. */
export const TOUCH_ONLY = "(pointer: coarse) and (hover: none)";

/** Whether this device is touch-only now; false where there is no `matchMedia`. */
export function isTouchOnly(): boolean {
  return typeof matchMedia === "function" && matchMedia(TOUCH_ONLY).matches;
}
