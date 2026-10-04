import type { SendOutcome } from "../lib/endpoints";
import type { AnswerInput } from "./study-state";
import { queueText, readQueue } from "./stored-queue";

/** The part of `sessionStorage` the queue uses. */
export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AnswerQueue {
  pending(): readonly AnswerInput[];
  retryAt(): number;
  /** Wait for sends already scheduled without starting another attempt. */
  settled(): Promise<void>;
  deferUntil(deadline: number): void;
  /** Queues `answer` and sends everything pending; `true` when nothing is left. */
  enqueue(answer: AnswerInput): Promise<boolean>;
  flush(): Promise<boolean>;
  clear(): void;
  /** For a successfully deleted card only: remove its unsent answers, preserving every other answer. */
  removeCard(cardId: string): void;
}

export {
  flushEarlierRounds,
  queueKey,
  sessionStore,
  unsavedAnswers,
  type ListedStorage,
} from "./earlier-answers";

/** A small batch fits both activities' existing HTTP limits. */
const ANSWERS_PER_SEND = 20;

/**
 * Sends pending answers in order, batching when the activity supplies a sender.
 * A failed batch stays at the head of
 * the queue, mirrored to `storage` so a reload keeps it, and goes out again
 * ahead of the next answer: practice never waits on the server.
 */
export function createAnswerQueue(options: {
  readonly key: string;
  readonly send: (answer: AnswerInput) => Promise<SendOutcome>;
  readonly sendBatch?: (answers: readonly AnswerInput[]) => Promise<SendOutcome>;
  readonly storage?: QueueStorage | undefined;
}): AnswerQueue {
  const { key, send, sendBatch, storage } = options;
  const loaded = readQueue(() => storage?.getItem(key));
  let pending = loaded.answers;
  let retryAt = loaded.retryAt;
  let chain: Promise<boolean> = Promise.resolve(true);
  let generation = 0;

  function persist(): void {
    try {
      const text = queueText(pending, retryAt);
      if (text === undefined) storage?.removeItem(key);
      else storage?.setItem(key, text);
    } catch {
      // Storage may be full or blocked; the queue in memory still holds the answers.
    }
  }

  async function drain(): Promise<boolean> {
    const fallbackIds = new Set<string>();
    while (pending[0] !== undefined) {
      if (Date.now() < retryAt) return false;
      const answer = pending[0];
      const batching = sendBatch !== undefined && !fallbackIds.has(answer.id);
      const batch = !batching
        ? [answer]
        : pending
            .slice(0, ANSWERS_PER_SEND)
            .filter((value) => value.roundId === answer.roundId);
      const ids = new Set(batch.map((value) => value.id));
      const epoch = generation;
      const outcome = await (batching ? sendBatch(batch) : send(answer));
      if (epoch !== generation) continue;
      if (batching && outcome === "rejected") {
        // A batch refusal cannot identify which answers are permanently invalid.
        for (const id of ids) fallbackIds.add(id);
        continue;
      }
      if (outcome === "failed" || typeof outcome === "object") {
        retryAt = typeof outcome === "object" ? outcome.retryAt : 0;
        persist();
        if (pending.some((value) => ids.has(value.id)) || Date.now() < retryAt)
          return false;
      }
      retryAt = 0;
      pending = pending.filter((value) => !ids.has(value.id));
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
    retryAt: () => retryAt,
    settled: () => chain.then(() => undefined),
    deferUntil(deadline) {
      retryAt = Math.max(retryAt, deadline);
      persist();
    },
    enqueue(answer) {
      pending = [...pending, answer];
      persist();
      return schedule();
    },
    flush: schedule,
    removeCard(cardId) {
      pending = pending.filter((answer) => answer.cardId !== cardId);
      persist();
    },
    clear() {
      generation += 1;
      retryAt = 0;
      pending = [];
      persist();
    },
  };
}
