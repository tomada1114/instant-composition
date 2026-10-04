import { VOCAB_STORAGE_LOCK } from "../lib/learner-storage";
import type { QueueStorage } from "../study/answer-queue";
import type { OutboxLock } from "./paged-outbox";
import { recoverOutbox } from "./outbox-state";
import { purgeEmptyOutbox } from "./outbox-cleanup";

/** Owner adoption is queued at construction, so even an idle earlier instance is fenced by finish. */
export function outboxAccess(options: {
  readonly key: string;
  readonly storage: QueueStorage | undefined;
  readonly locks: OutboxLock | undefined;
  readonly valid?: () => boolean;
}): {
  readonly locked: <T>(work: (storage: QueueStorage) => T | Promise<T>) => Promise<T>;
  readonly current: () => boolean;
  readonly complete: (clear: () => void) => Promise<boolean>;
} {
  const { storage, locks, key } = options;
  const ownerKey = `${key}:owner`;
  let owner: string | undefined,
    completed = false;
  let observed: string | null | undefined;
  try {
    observed = storage?.getItem(ownerKey);
  } catch {
    /* An unreadable owner cannot be adopted. */
  }
  const adoption =
    storage === undefined || locks === undefined
      ? Promise.resolve()
      : locks
          .request(VOCAB_STORAGE_LOCK, () => {
            if (options.valid?.() === false || observed === undefined)
              return Promise.resolve();
            const kept = storage.getItem(ownerKey);
            if (observed !== null && observed !== kept) return Promise.resolve();
            if (
              kept !== null &&
              !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/u.test(kept)
            )
              return Promise.resolve();
            recoverOutbox(storage, key);
            owner = kept ?? crypto.randomUUID();
            if (kept === null) storage.setItem(ownerKey, owner);
            return Promise.resolve();
          })
          .catch(() => {
            owner = undefined;
          });
  function current(): boolean {
    try {
      return (
        !completed &&
        options.valid?.() !== false &&
        (owner === undefined || storage?.getItem(ownerKey) === owner)
      );
    } catch {
      return false;
    }
  }
  async function locked<T>(work: (held: QueueStorage) => T | Promise<T>): Promise<T> {
    await adoption;
    if (storage === undefined || locks === undefined || owner === undefined)
      throw new Error(
        "Durable outbox requires an adopted owner, storage and Web Locks.",
      );
    return locks.request(VOCAB_STORAGE_LOCK, async () => {
      if (!current()) throw new Error("Outbox belongs to an invalidated session.");
      recoverOutbox(storage, key);
      return await work(storage);
    });
  }
  return {
    current,
    locked,
    async complete(clear) {
      try {
        return await locked((held) => {
          if (!purgeEmptyOutbox(held, key)) return false;
          clear();
          held.removeItem(ownerKey);
          completed = true;
          return true;
        });
      } catch {
        return false;
      }
    },
  };
}
