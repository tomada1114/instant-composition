/** One open talk on this browser; no record or draft text is stored here. */
export const TALK_STORAGE_KEY = "instant-composition:open-talk";

export function readTalkId(): string | undefined {
  try {
    return localStorage.getItem(TALK_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberTalk(talkId: string): void {
  try {
    localStorage.setItem(TALK_STORAGE_KEY, talkId);
  } catch {
    // This browser can still talk, without resuming after a reload.
  }
}

/** A late answer for an older talk never clears the current talk's id. */
export function forgetTalk(talkId: string): void {
  try {
    if (localStorage.getItem(TALK_STORAGE_KEY) === talkId)
      localStorage.removeItem(TALK_STORAGE_KEY);
  } catch {
    // Unavailable storage disables resume, without interrupting the talk.
  }
}
