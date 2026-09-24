const STORAGE_KEY = "instant-composition:last-round";

/**
 * Remembers the round that just finished, for the recap screen to read back.
 *
 * @remarks
 * The contract reads a summary by its round's id and names no "today's last
 * round", so the client keeps the id of the last round it finished itself.
 * Storage that throws (a private window, a full quota) only means the recap
 * has nothing to show and hands over to the start screen.
 */
export function rememberFinishedRound(roundId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, roundId);
  } catch {
    // Not remembered; the recap goes to the start screen instead.
  }
}

/** The id {@link rememberFinishedRound} kept last, or `undefined` for none. */
export function lastFinishedRound(): string | undefined {
  try {
    const roundId = localStorage.getItem(STORAGE_KEY);
    return roundId === null || roundId === "" ? undefined : roundId;
  } catch {
    return undefined;
  }
}
