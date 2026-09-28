import { describe, expect, it } from "vitest";

import {
  type AnswerInput,
  createAnswerQueue,
  type QueueStorage,
  type SendOutcome,
} from "@instant-composition/web";

function answer(cardId: string): AnswerInput {
  return {
    id: `r:f:${cardId}`,
    roundId: "r",
    cardId,
    pass: "first",
    result: "ok",
    elapsedMs: 1000,
    answeredAt: 1_790_000_000_000,
  };
}

function memoryStorage(initial: Record<string, string> = {}): QueueStorage & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** A sender answering from a script of outcomes, recording what it was asked to send. */
function scriptedSender(...outcomes: SendOutcome[]) {
  const sent: string[] = [];
  return {
    sent,
    send: (item: AnswerInput): Promise<SendOutcome> => {
      sent.push(item.cardId);
      return Promise.resolve(outcomes.shift() ?? "sent");
    },
  };
}

describe("createAnswerQueue", () => {
  it("sends an answer and keeps nothing once it is delivered", async () => {
    const storage = memoryStorage();
    const sender = scriptedSender("sent");
    const queue = createAnswerQueue({ key: "k", send: sender.send, storage });
    expect(await queue.enqueue(answer("c1"))).toBe(true);
    expect(sender.sent).toStrictEqual(["c1"]);
    expect(queue.pending()).toStrictEqual([]);
    expect(storage.data.has("k")).toBe(false);
  });

  it("holds a failed answer, mirrors it to storage, and resends it before the next one", async () => {
    const storage = memoryStorage();
    const sender = scriptedSender("failed", "sent", "sent");
    const queue = createAnswerQueue({ key: "k", send: sender.send, storage });
    expect(await queue.enqueue(answer("c1"))).toBe(false);
    expect(queue.pending().map((a) => a.cardId)).toStrictEqual(["c1"]);
    expect(JSON.parse(storage.data.get("k") ?? "[]")).toStrictEqual([answer("c1")]);

    expect(await queue.enqueue(answer("c2"))).toBe(true);
    expect(sender.sent).toStrictEqual(["c1", "c1", "c2"]);
    expect(queue.pending()).toStrictEqual([]);
  });

  it("stops at the first failure so answers stay in order", async () => {
    const sender = scriptedSender("failed", "failed");
    const queue = createAnswerQueue({ key: "k", send: sender.send });
    await queue.enqueue(answer("c1"));
    expect(await queue.enqueue(answer("c2"))).toBe(false);
    expect(sender.sent).toStrictEqual(["c1", "c1"]);
    expect(queue.pending().map((a) => a.cardId)).toStrictEqual(["c1", "c2"]);
  });

  it("drops an answer the server refused, since resending cannot change that", async () => {
    const sender = scriptedSender("rejected");
    const queue = createAnswerQueue({ key: "k", send: sender.send });
    expect(await queue.enqueue(answer("c1"))).toBe(true);
    expect(queue.pending()).toStrictEqual([]);
  });

  it("sends one answer at a time even when they arrive together", async () => {
    let inFlight = 0;
    let most = 0;
    const queue = createAnswerQueue({
      key: "k",
      send: async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return "sent";
      },
    });
    await Promise.all([queue.enqueue(answer("c1")), queue.enqueue(answer("c2"))]);
    expect(most).toBe(1);
  });

  it("keeps each answer's wall-clock time through storage and hands it to the sender", async () => {
    const storage = memoryStorage();
    const given: AnswerInput[] = [];
    const first = createAnswerQueue({
      key: "k",
      send: () => Promise.resolve("failed"),
      storage,
    });
    await first.enqueue({ ...answer("c1"), answeredAt: 1_790_000_000_123 });

    const reloaded = createAnswerQueue({
      key: "k",
      send: (item) => {
        given.push(item);
        return Promise.resolve("sent");
      },
      storage,
    });
    expect(await reloaded.flush()).toBe(true);
    expect(given.map((item) => item.answeredAt)).toStrictEqual([1_790_000_000_123]);
  });

  it("keeps an answer an earlier build stored without its time", () => {
    const untimed: AnswerInput = {
      id: "r:f:c1",
      roundId: "r",
      cardId: "c1",
      pass: "first",
      result: "ok",
      elapsedMs: 1000,
    };
    const queue = createAnswerQueue({
      key: "k",
      send: scriptedSender().send,
      storage: memoryStorage({ k: JSON.stringify([untimed]) }),
    });
    expect(queue.pending()).toStrictEqual([untimed]);
  });

  it("picks up what an earlier page left in storage, and flushes it", async () => {
    const storage = memoryStorage({ k: JSON.stringify([answer("c1")]) });
    const sender = scriptedSender("sent");
    const queue = createAnswerQueue({ key: "k", send: sender.send, storage });
    expect(queue.pending().map((a) => a.cardId)).toStrictEqual(["c1"]);
    expect(await queue.flush()).toBe(true);
    expect(sender.sent).toStrictEqual(["c1"]);
  });

  it.each([
    ["text that is not JSON", "{"],
    ["JSON of the wrong shape", JSON.stringify([{ id: 1 }])],
    ["an object rather than a list", JSON.stringify({ id: "a" })],
    ["a list holding null", JSON.stringify([null])],
    [
      "an answer with an unknown pass",
      JSON.stringify([{ ...answer("c1"), pass: "third" }]),
    ],
    [
      "an answer with an unknown result",
      JSON.stringify([{ ...answer("c1"), result: "maybe" }]),
    ],
    [
      "an answer with a fractional time",
      JSON.stringify([{ ...answer("c1"), elapsedMs: 1.5 }]),
    ],
    ["an answer missing its round", JSON.stringify([{ ...answer("c1"), roundId: 1 }])],
    [
      "an answer with a time that is not whole milliseconds",
      JSON.stringify([{ ...answer("c1"), answeredAt: "2026-09-22" }]),
    ],
  ])("ignores %s in storage", (_, stored) => {
    const queue = createAnswerQueue({
      key: "k",
      send: scriptedSender().send,
      storage: memoryStorage({ k: stored }),
    });
    expect(queue.pending()).toStrictEqual([]);
  });

  it("keeps working when storage throws", async () => {
    const broken: QueueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const queue = createAnswerQueue({
      key: "k",
      send: scriptedSender("failed").send,
      storage: broken,
    });
    expect(await queue.enqueue(answer("c1"))).toBe(false);
    expect(queue.pending()).toHaveLength(1);
  });

  it("forgets everything on clear", async () => {
    const storage = memoryStorage();
    const queue = createAnswerQueue({
      key: "k",
      send: scriptedSender("failed").send,
      storage,
    });
    await queue.enqueue(answer("c1"));
    queue.clear();
    expect(queue.pending()).toStrictEqual([]);
    expect(storage.data.has("k")).toBe(false);
  });
});
