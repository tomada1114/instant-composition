export const VOCAB_STORAGE_LOCK = "instant-composition-vocab-storage";
const REVISION = "instant-composition-learner-storage:revision";
/** An origin-wide epoch prevents in-flight old outboxes from recreating another learner's bytes. */
export function learnerStorageRevision(): string {
  try {
    return window.localStorage.getItem(REVISION) ?? "0";
  } catch {
    return "unavailable";
  }
}
function removePrefixes(storage: Storage, prefixes: readonly string[]): void {
  for (let index = 0; index < storage.length;) {
    const key = storage.key(index);
    if (key !== null && prefixes.some((prefix) => key.startsWith(prefix)))
      storage.removeItem(key);
    else index += 1;
  }
}
/** Confirmed terminal auth loss or submitted logout clears learner state; reload and temporary failures retain it. */
export async function clearLearnerStorage(navigate?: () => void): Promise<void> {
  if (typeof window === "undefined") return;
  const clear = (): void => {
    // A successful native submit and the invalidation run in the same locked turn,
    // before navigation can unload the document. A refused submit retains all bytes.
    navigate?.();
    try {
      window.localStorage.setItem(REVISION, crypto.randomUUID());
      removePrefixes(window.localStorage, ["vocab-outbox:"]);
    } catch {
      /* Storage refusal cannot expose values or erase unrelated settings. */
    }
    try {
      removePrefixes(window.sessionStorage, ["vocab-active:", "vocab-checkpoint:"]);
    } catch {
      /* Blocked storage remains untouched. */
    }
  };
  const browser: { readonly navigator?: { readonly locks?: LockManager } } = globalThis;
  const locks = browser.navigator?.locks;
  if (locks === undefined) clear();
  else await locks.request(VOCAB_STORAGE_LOCK, clear);
}
