import type { QueueStorage } from "../study/answer-queue";
import { readAnswer } from "../study/stored-answer";
import type { AnswerInput } from "../study/study-state";

export const OUTBOX_SIZE = 20;
export interface OutboxMeta {
  readonly head: number;
  readonly tail: number;
  readonly offset: number;
  readonly tailLength: number;
  readonly count: number;
  readonly retryAt: number;
}
export interface OutboxHead {
  readonly meta: OutboxMeta;
  readonly answers: readonly AnswerInput[];
  readonly consumed: number;
}
const EMPTY: OutboxMeta = {
  head: 0,
  tail: 0,
  offset: 0,
  tailLength: 0,
  count: 0,
  retryAt: 0,
};
export function outboxPageKey(key: string, page: number): string {
  return `${key}:page:${String(page)}`;
}
export function outboxRemovedKey(key: string, cardId: string): string {
  return `${key}:removed:${cardId}`;
}
export function outboxMeta(storage: QueueStorage, key: string): OutboxMeta {
  const raw = storage.getItem(key);
  if (raw === null) return EMPTY;
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 6 ||
    !["head", "tail", "offset", "tailLength", "count", "retryAt"].every((name) =>
      Object.hasOwn(value, name),
    ) ||
    !Object.values(value).every(
      (number) =>
        typeof number === "number" && Number.isSafeInteger(number) && number >= 0,
    )
  )
    throw new Error("Unreadable outbox metadata.");
  const meta = value as OutboxMeta;
  if (
    meta.head > meta.tail ||
    meta.tailLength > OUTBOX_SIZE ||
    meta.offset > OUTBOX_SIZE ||
    (meta.head === meta.tail
      ? meta.offset > meta.tailLength
      : meta.offset >= OUTBOX_SIZE || meta.tailLength === 0) ||
    !Number.isSafeInteger(
      (meta.tail - meta.head) * OUTBOX_SIZE + meta.tailLength - meta.offset,
    ) ||
    meta.count !== (meta.tail - meta.head) * OUTBOX_SIZE + meta.tailLength - meta.offset
  )
    throw new Error("Unreadable outbox counters.");
  return meta;
}
export function outboxPage(
  storage: QueueStorage,
  key: string,
  number: number,
): readonly AnswerInput[] {
  return outboxPageText(storage.getItem(outboxPageKey(key, number)));
}
export function outboxPageText(raw: string | null): readonly AnswerInput[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > OUTBOX_SIZE)
    throw new Error("Unreadable outbox page.");
  const answers = value.map((entry: unknown) => readAnswer(entry));
  if (answers.some((entry) => entry === undefined))
    throw new Error("Unreadable outbox answer.");
  return answers.flatMap((answer) => answer ?? []);
}
export function saveOutboxMeta(
  storage: QueueStorage,
  key: string,
  meta: OutboxMeta,
): void {
  storage.setItem(key, JSON.stringify(meta));
}
/** One append may precede its checkpoint. Recovery checks the head and at most two fixed tail pages. */
export function recoverOutbox(storage: QueueStorage, key: string): OutboxMeta {
  const before = outboxMeta(storage, key);
  const page = outboxPage(storage, key, before.tail);
  const next =
    page.length === OUTBOX_SIZE ? outboxPage(storage, key, before.tail + 1) : [];
  const head =
    before.head === before.tail ? page : outboxPage(storage, key, before.head);
  if (
    page.length < before.tailLength ||
    page.length - before.tailLength > 1 ||
    next.length > 1 ||
    before.offset > head.length ||
    (before.head < before.tail && head.length !== OUTBOX_SIZE)
  )
    throw new Error("Unreadable outbox pages.");
  const meta =
    next.length === 0
      ? {
          ...before,
          count: before.count + page.length - before.tailLength,
          tailLength: page.length,
        }
      : {
          ...before,
          tail: before.tail + 1,
          count: before.count + page.length - before.tailLength + next.length,
          tailLength: next.length,
        };
  if (
    !Number.isSafeInteger(meta.count) ||
    meta.count < 0 ||
    !Number.isSafeInteger(meta.tail)
  )
    throw new Error("Unreadable outbox count.");
  if (meta.tail !== before.tail || meta.tailLength !== before.tailLength)
    saveOutboxMeta(storage, key, meta);
  if (meta.head > 0) storage.removeItem(outboxPageKey(key, meta.head - 1));
  return meta;
}
/** Page bytes precede metadata; an interrupted metadata write is recovered under the same answer id. */
export function appendOutbox(
  storage: QueueStorage,
  key: string,
  answer: AnswerInput,
): void {
  const meta = recoverOutbox(storage, key);
  if (storage.getItem(key) === null) saveOutboxMeta(storage, key, meta);
  const page = outboxPage(storage, key, meta.tail);
  if (page.some((entry) => entry.id === answer.id)) return;
  const tail = page.length === OUTBOX_SIZE ? meta.tail + 1 : meta.tail;
  const answers = page.length === OUTBOX_SIZE ? [answer] : [...page, answer];
  storage.setItem(outboxPageKey(key, tail), JSON.stringify(answers));
  saveOutboxMeta(storage, key, {
    ...meta,
    tail,
    tailLength: answers.length,
    count: meta.count + 1,
  });
}
export function headOutbox(storage: QueueStorage, key: string): OutboxHead {
  const meta = recoverOutbox(storage, key);
  const page = outboxPage(storage, key, meta.head).slice(meta.offset);
  if (meta.count > 0 && page.length === 0)
    throw new Error("Missing pending outbox page.");
  return {
    meta,
    answers: page.filter(
      (answer) => storage.getItem(outboxRemovedKey(key, answer.cardId)) === null,
    ),
    consumed: page.length,
  };
}
/** A second drainer may acknowledge the same batch; only the still-current head advances. */
export function acknowledgeOutbox(
  storage: QueueStorage,
  key: string,
  sent: OutboxHead,
): void {
  const meta = recoverOutbox(storage, key);
  if (meta.head !== sent.meta.head || meta.offset !== sent.meta.offset) return;
  const offset = meta.offset + sent.consumed;
  const page = outboxPage(storage, key, meta.head);
  const done = offset === page.length;
  const empty = done && meta.head === meta.tail;
  storage.setItem(
    `${key}:recent`,
    JSON.stringify(
      outboxPage(storage, key, meta.head).slice(
        meta.offset,
        meta.offset + sent.consumed,
      ),
    ),
  );
  saveOutboxMeta(storage, key, {
    ...meta,
    count: meta.count - sent.consumed,
    retryAt: 0,
    head: done ? meta.head + 1 : meta.head,
    tail: empty ? meta.tail + 1 : meta.tail,
    offset: done ? 0 : offset,
    tailLength: empty ? 0 : meta.tailLength,
  });
  if (done) storage.removeItem(outboxPageKey(key, meta.head));
}
