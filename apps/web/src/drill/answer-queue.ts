import type { SendOutcome } from "../lib/endpoints";
import type { AnswerInput } from "./drill-state";

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

const PASSES: readonly unknown[] = ["first", "retry"];
const RESULTS: readonly unknown[] = ["ok", "ng", "timeout"];

/** Whether `value` is one answer as this queue stored it; storage is the browser's, so it is read as untrusted. */
function isAnswer(value: unknown): value is AnswerInput {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<Record<keyof AnswerInput, unknown>>;
  return (
    typeof entry.id === "string" &&
    typeof entry.roundId === "string" &&
    typeof entry.cardId === "string" &&
    PASSES.includes(entry.pass) &&
    RESULTS.includes(entry.result) &&
    Number.isInteger(entry.elapsedMs) &&
    (entry.answeredAt === undefined || Number.isInteger(entry.answeredAt))
  );
}

function load(storage: QueueStorage | undefined, key: string): AnswerInput[] {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isAnswer) ? parsed : [];
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

/** The tab's `sessionStorage`, or nothing where reading it throws (storage blocked). */
export function sessionStore(): QueueStorage | undefined {
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
