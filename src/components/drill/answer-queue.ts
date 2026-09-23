import * as z from "zod";

import { answerInputSchema, type AnswerInput } from "../../core/api";

/** What became of one send: delivered, refused for good, or worth retrying. */
export type SendOutcome = "sent" | "rejected" | "failed";

/** The part of `sessionStorage` the queue uses. */
export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AnswerQueue {
  pending(): readonly AnswerInput[];
  /** Queues `answer` and sends everything pending; `true` when nothing is left. */
  enqueue(answer: AnswerInput): Promise<boolean>;
  flush(): Promise<boolean>;
  clear(): void;
}

const storedSchema = z.array(answerInputSchema);

function load(storage: QueueStorage | undefined, key: string): AnswerInput[] {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return [];
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Sends answers one at a time, in order. A failed send stays at the head of
 * the queue, mirrored to `storage` so a reload keeps it, and goes out again
 * ahead of the next answer: practice never waits on the server.
 */
export function createAnswerQueue(options: {
  readonly key: string;
  readonly send: (answer: AnswerInput) => Promise<SendOutcome>;
  readonly storage?: QueueStorage | undefined;
}): AnswerQueue {
  const { key, send, storage } = options;
  let pending = load(storage, key);
  let chain: Promise<boolean> = Promise.resolve(true);

  function persist(): void {
    try {
      if (pending.length === 0) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify(pending));
    } catch {
      // Storage may be full or blocked; the queue in memory still holds the answers.
    }
  }

  async function drain(): Promise<boolean> {
    while (pending[0] !== undefined) {
      if ((await send(pending[0])) === "failed") return false;
      pending = pending.slice(1);
      persist();
    }
    return true;
  }

  function schedule(): Promise<boolean> {
    chain = chain.then(drain);
    return chain;
  }

  return {
    pending: () => pending,
    enqueue(answer) {
      pending = [...pending, answer];
      persist();
      return schedule();
    },
    flush: schedule,
    clear() {
      pending = [];
      persist();
    },
  };
}
