import { VOCAB_STORAGE_LOCK } from "../lib/learner-storage";
import type { QueueStorage } from "../study/answer-queue";
import type { AnswerInput } from "../study/study-state";
import type { SendOutcome } from "../lib/api-call";
import {
  appendOutbox,
  outboxMeta,
  outboxPage,
  recoverOutbox,
  headOutbox,
  acknowledgeOutbox,
  saveOutboxMeta,
  outboxRemovedKey,
  outboxPageText,
} from "./outbox-state";

export interface OutboxLock {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}
export interface PagedOutbox {
  count(): number;
  retryAt(): number;
  deferUntil(deadline: number): Promise<void>;
  tail(): Promise<readonly AnswerInput[]>;
  append(answer: AnswerInput): Promise<boolean>;
  flush(): Promise<boolean>;
  removeCard(cardId: string): Promise<boolean>;
}
/** No key listing or whole pending array. Cross-document writes use actual Web Locks in the browser. */
export function createPagedOutbox(options: {
  readonly key: string;
  readonly storage: QueueStorage | undefined;
  readonly locks: OutboxLock | undefined;
  readonly send: (answers: readonly AnswerInput[]) => Promise<SendOutcome>;
  readonly valid?: () => boolean;
}): PagedOutbox {
  const { key, storage, locks, send } = options;
  let count = 0;
  let chain = Promise.resolve(true);
  function locked<T>(work: (held: QueueStorage) => T | Promise<T>): Promise<T> {
    if (storage === undefined || locks === undefined)
      return Promise.reject(
        new Error("Durable outbox requires storage and Web Locks."),
      );
    return locks.request(VOCAB_STORAGE_LOCK, async () => {
      if (options.valid?.() === false)
        throw new Error("Outbox belongs to an invalidated session.");
      recoverOutbox(storage, key);
      const result = await work(storage);
      count = outboxMeta(storage, key).count;
      return result;
    });
  }
  async function drain(): Promise<boolean> {
    try {
      for (;;) {
        const head = await locked((held) => headOutbox(held, key));
        if (head.meta.count === 0) return true;
        if (Date.now() < head.meta.retryAt) return false;
        const sent = head.answers.length === 0 ? "sent" : await send(head.answers);
        if (sent === "failed" || typeof sent === "object") {
          if (typeof sent === "object")
            await locked((held) => {
              const meta = recoverOutbox(held, key);
              saveOutboxMeta(held, key, {
                ...meta,
                retryAt: Math.max(meta.retryAt, sent.retryAt),
              });
            });
          return false;
        }
        await locked((held) => {
          acknowledgeOutbox(held, key, head);
        });
      }
    } catch {
      return false;
    }
  }
  return {
    count() {
      if (options.valid?.() === false) return 0;
      try {
        if (storage !== undefined) count = outboxMeta(storage, key).count;
      } catch {
        /* Unreadable durable data is retained. */
      }
      return count;
    },
    retryAt() {
      try {
        return storage === undefined ? 0 : outboxMeta(storage, key).retryAt;
      } catch {
        return Infinity;
      }
    },
    async deferUntil(deadline) {
      try {
        await locked((held) => {
          const meta = recoverOutbox(held, key);
          saveOutboxMeta(held, key, {
            ...meta,
            retryAt: Math.max(meta.retryAt, deadline),
          });
        });
      } catch {
        /* Preserve durable data on storage refusal. */
      }
    },
    async tail() {
      try {
        return await locked((held) => {
          const meta = recoverOutbox(held, key);
          const tail = outboxPage(held, key, meta.tail).slice(
            meta.head === meta.tail ? meta.offset : 0,
          );
          return tail.length > 0 ? tail : outboxPageText(held.getItem(`${key}:recent`));
        });
      } catch {
        return [];
      }
    },
    async append(answer) {
      try {
        await locked((held) => {
          appendOutbox(held, key, answer);
        });
        return true;
      } catch {
        return false;
      }
    },
    flush() {
      chain = chain.then(drain);
      return chain;
    },
    async removeCard(cardId) {
      try {
        await locked((held) => {
          held.setItem(outboxRemovedKey(key, cardId), "1");
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
