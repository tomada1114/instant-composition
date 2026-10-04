import type { SendOutcome } from "../lib/endpoints";
import type { AnswerInput } from "./study-state";
import { createAnswerQueue, type QueueStorage } from "./answer-queue";

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
  readonly sendBatch?: (answers: readonly AnswerInput[]) => Promise<SendOutcome>;
  readonly storage?: ListedStorage | undefined;
}): Promise<boolean> {
  const { currentId, send, sendBatch, storage } = options;
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
      const queue = createAnswerQueue({
        key,
        send,
        storage,
        ...(sendBatch === undefined ? {} : { sendBatch }),
      });
      if (queue.pending().length === 0) {
        if (Date.now() < queue.retryAt()) empty = false;
        else queue.clear();
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
