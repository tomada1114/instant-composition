import type { SendOutcome } from "../lib/endpoints";
import type { AnswerInput } from "./drill-state";
import { readAnswer } from "./stored-answer";

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

function load(storage: QueueStorage | undefined, key: string): AnswerInput[] {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const answers = parsed.map(readAnswer);
    return answers.every((answer) => answer !== undefined) ? answers : [];
  } catch {
    return [];
  }
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
const flushing = new Set<string>();

/** The storage key holding the unsent answers of round `roundId`. */
export function queueKey(roundId: string): string {
  return `${PREFIX}${roundId}`;
}

/**
 * Sends, under their fixed ids, what earlier pages of this tab left queued for
 * rounds other than `currentId` — one abandoned at the day's turn or by another
 * kind, which the server still takes. A key empties as its answers are sent or
 * refused (a finished round answers `ERR_ROUND_CLOSED`); only a failed send
 * stays for the next arrival. Nothing here waits on or reports to the current round.
 */
export async function flushEarlierRounds(options: {
  readonly currentId: string;
  /** Other activities have their own storage namespace and sender. */
  readonly prefix?: string;
  readonly send: (answer: AnswerInput) => Promise<SendOutcome>;
  readonly storage?: ListedStorage | undefined;
}): Promise<void> {
  const { currentId, send, storage } = options;
  const prefix = options.prefix ?? PREFIX;
  const keys: string[] = [];
  try {
    for (let index = 0; index < (storage?.length ?? 0); index += 1) {
      const key = storage?.key(index);
      if (
        key?.startsWith(prefix) === true &&
        key !== `${prefix}${currentId}` &&
        !flushing.has(key)
      )
        keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) flushing.add(key);
  for (const key of keys) {
    const queue = createAnswerQueue({ key, send, storage });
    try {
      if (queue.pending().length === 0) queue.clear();
      else await queue.flush();
    } finally {
      flushing.delete(key);
    }
  }
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
