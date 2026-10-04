import type { OutboxLock, QueueStorage, AnswerInput } from "@instant-composition/web";
/** Serial fake of the Web Locks boundary, shared by every document/instance in a test. */
export function outboxLocks(): OutboxLock {
  const running = new Map<string, Promise<unknown>>();
  return {
    async request(name, callback) {
      const previous = running.get(name) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(callback);
      running.set(name, next);
      try {
        return await next;
      } finally {
        if (running.get(name) === next) running.delete(name);
      }
    },
  };
}
export function outboxStorage(): QueueStorage & {
  readonly values: Map<string, string>;
  largest(): number;
} {
  const values = new Map<string, string>();
  let largest = 0;
  return {
    values,
    largest: () => largest,
    getItem(key: string) {
      const raw = values.get(key) ?? null;
      if (key.includes(":page:") && raw !== null)
        largest = Math.max(largest, (JSON.parse(raw) as unknown[]).length);
      return raw;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}
export function outboxAnswer(index: number): AnswerInput {
  return {
    id: `p:${String(Math.floor(index / 64))}:0:${String(index % 64)}`,
    roundId: "session",
    cardId: `v_${String(index)}`,
    pass: "first" as const,
    grade: "good" as const,
    timedOut: false,
    elapsedMs: 100,
    answeredAt: 1000,
    vocabPage: Math.floor(index / 64),
    vocabGeneration: 1,
  };
}
