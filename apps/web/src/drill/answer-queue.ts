import type { SendOutcome } from "../lib/endpoints";
import type { AnswerInput } from "./drill-state";
import { readQueue } from "./stored-queue";

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
  /** For a successfully deleted card only: remove its unsent answers, preserving every other answer. */
  removeCard(cardId: string): void;
}

/**
 * What an earlier page of this tab queued in `round` that the server does not
 * hold yet, once each: a reload resumes past these while the queue sends them
 * again under the same ids, which the server takes only once.
 */
export function unsavedAnswers(
  pending: readonly AnswerInput[],
  round: {
    readonly id: string;
    readonly deck: readonly string[];
    readonly answered: readonly { readonly id: string }[];
  },
): readonly AnswerInput[] {
  const held = new Set(round.answered.map((answer) => answer.id));
  return pending.filter((answer) => {
    if (answer.roundId !== round.id || !round.deck.includes(answer.cardId))
      return false;
    if (held.has(answer.id)) return false;
    held.add(answer.id);
    return true;
  });
}

/** Storage whose keys can be listed, as `sessionStorage`'s can. */
export interface ListedStorage extends QueueStorage {
  readonly length: number;
  key(index: number): string | null;
}

const PREFIX = "drill-answers:";
/** Keys a flush is already sending, so a second arrival (a remount) never sends them alongside it. */
const flushing = new Map<string, Promise<boolean>>();

/** The storage key holding the unsent answers of round `roundId`. */
export function queueKey(roundId: string): string {
  return `${PREFIX}${roundId}`;
}

/**
 * Sends, under their fixed ids, what earlier pages of this tab left queued for
 * rounds other than `currentId` — one abandoned at the day's turn or by another
 * kind, which the server still takes. A key empties as its answers are sent or
 * refused (a finished round answers `ERR_ROUND_CLOSED`); only a failed send
 * stays for the next arrival. Reports whether all earlier queues are empty, awaiting
 * a flush already in flight on another arrival.
 */
export async function flushEarlierRounds(options: {
  readonly currentId: string;
  /** Other activities have their own storage namespace and sender. */
  readonly prefix?: string;
  readonly send: (answer: AnswerInput) => Promise<SendOutcome>;
  readonly storage?: ListedStorage | undefined;
}): Promise<boolean> {
  const { currentId, send, storage } = options;
  const prefix = options.prefix ?? PREFIX;
  const keys: string[] = [];
  try {
    for (let index = 0; index < (storage?.length ?? 0); index += 1) {
      const key = storage?.key(index);
      if (key?.startsWith(prefix) === true && key !== `${prefix}${currentId}`)
        keys.push(key);
    }
  } catch {
    return false;
  }
  let empty = true;
  for (const key of keys) {
    let pending = flushing.get(key);
    if (pending === undefined) {
      const queue = createAnswerQueue({ key, send, storage });
      if (queue.pending().length === 0) {
        queue.clear();
        continue;
      }
      pending = queue.flush().finally(() => {
        flushing.delete(key);
      });
      flushing.set(key, pending);
    }
    if (!(await pending)) empty = false;
  }
  return empty;
}

/** The tab's `sessionStorage`, or nothing where reading it throws (storage blocked). */
export function sessionStore(): ListedStorage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
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
  const loaded = readQueue(() => storage?.getItem(key));
  let pending = loaded.answers;
  let retryAt = loaded.retryAt;
  let chain: Promise<boolean> = Promise.resolve(true);

  function persist(): void {
    try {
      if (pending.length === 0) {
        retryAt = 0;
        storage?.removeItem(key);
      } else
        storage?.setItem(
          key,
          JSON.stringify(retryAt > 0 ? { answers: pending, retryAt } : pending),
        );
    } catch {
      // Storage may be full or blocked; the queue in memory still holds the answers.
    }
  }

  async function drain(): Promise<boolean> {
    while (pending[0] !== undefined) {
      if (Date.now() < retryAt) return false;
      const answer = pending[0];
      const outcome = await send(answer);
      if (outcome === "failed" || typeof outcome === "object") {
        retryAt = typeof outcome === "object" ? outcome.retryAt : 0;
        persist();
        if (
          pending.some((value) => value.id === answer.id) ||
          (pending.length > 0 && Date.now() < retryAt)
        )
          return false;
      }
      retryAt = 0;
      pending = pending.filter((value) => value.id !== answer.id);
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
    removeCard(cardId) {
      pending = pending.filter((answer) => answer.cardId !== cardId);
      persist();
    },
    clear() {
      pending = [];
      persist();
    },
  };
}
