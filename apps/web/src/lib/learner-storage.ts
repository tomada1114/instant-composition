export const VOCAB_STORAGE_LOCK = "instant-composition-vocab-storage";
const REVISION = "instant-composition-learner-storage:revision";
/** An origin-wide epoch prevents in-flight old outboxes from recreating another learner's bytes. */
export function learnerStorageRevision(): string {
  try {
    const storage = window.localStorage;
    const kept = storage.getItem(REVISION);
    if (kept !== null) return kept;
    const revision = crypto.randomUUID();
    storage.setItem(REVISION, revision);
    return revision;
  } catch {
    // A non-persisted observation never authorizes another observation's writes.
    return crypto.randomUUID();
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
    } catch {
      try {
        // Quota prevents growth, but deletion can still invalidate every document.
        window.localStorage.removeItem(REVISION);
      } catch {
        /* Blocked storage remains untouched. */
      }
    }
    try {
      removePrefixes(window.localStorage, ["vocab-outbox:"]);
    } catch {
      /* Cleanup is independent of epoch persistence and unrelated settings. */
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
