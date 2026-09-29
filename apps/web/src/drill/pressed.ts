/**
 * Whether the round `/drill` is about to open was asked for by a press in this
 * page. Kept in memory rather than in the history entry's state, because a
 * reload keeps `history.state` and a reloaded round must not start by itself.
 */
let pressed = false;

/** Called by a button that starts a round, just before it navigates. */
export function markPressed(): void {
  pressed = true;
}

/** Reads the mark without spending it, so a render may read it twice. */
export function wasPressed(): boolean {
  return pressed;
}

/** Spends the mark once the round screen has read it. */
export function clearPressed(): void {
  pressed = false;
}
