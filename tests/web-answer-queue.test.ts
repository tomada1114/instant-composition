import { describe, expect, it, vi } from "vitest";

import {
  type AnswerInput,
  createAnswerQueue,
  flushEarlierRounds,
  type ListedStorage,
  type QueueStorage,
  type SendOutcome,
} from "@instant-composition/web";

function answer(cardId: string): AnswerInput {
  return {
    id: `r:f:${cardId}`,
    roundId: "r",
    cardId,
    pass: "first",
    grade: "good",
    timedOut: false,
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
  it("retains a deferred finish without pending answers across reload, until explicitly cleared", () => {
    const storage = memoryStorage();
    const sender = scriptedSender();
    const queue = createAnswerQueue({ key: "k", send: sender.send, storage });
    queue.deferUntil(20_000);
    queue.deferUntil(15_000);
    const reloaded = createAnswerQueue({ key: "k", send: sender.send, storage });
    expect(reloaded.pending()).toStrictEqual([]);
    expect(reloaded.retryAt()).toBe(20_000);
    reloaded.clear();
    expect(reloaded.retryAt()).toBe(0);
    expect(storage.data.has("k")).toBe(false);
  });
  it("honors a late Retry-After response after the in-flight card is deleted", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    let resolve: (outcome: SendOutcome) => void = () => undefined;
    const sending = new Promise<SendOutcome>((done) => {
      resolve = done;
    });
    const sent: string[] = [];
    const queue = createAnswerQueue({
      key: "k",
      send: (input) => {
        sent.push(input.cardId);
        return sending;
      },
    });
    const first = queue.enqueue(answer("c1"));
    await Promise.resolve();
    const next = queue.enqueue(answer("c2"));
    queue.removeCard("c1");
    resolve({ status: "failed", retryAt: 20_000 });
    expect(await first).toBe(false);
    expect(await next).toBe(false);
    expect(sent).toStrictEqual(["c1"]);
    expect(queue.pending()).toStrictEqual([answer("c2")]);
    vi.restoreAllMocks();
  });
  it("keeps a Retry-After deadline across reload and records the same IDs once after recovery", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const storage = memoryStorage();
    const sender = scriptedSender(
      { status: "failed", retryAt: 20_000 },
      "sent",
      "sent",
    );
    const queue = createAnswerQueue({ key: "k", send: sender.send, storage });
    expect(await queue.enqueue(answer("c1"))).toBe(false);
    expect(await queue.enqueue(answer("c2"))).toBe(false);
    expect(sender.sent).toStrictEqual(["c1"]);

    const recorded: string[] = [];
    const reloaded = createAnswerQueue({
      key: "k",
      storage,
      send: (input) => {
        recorded.push(input.id);
        return Promise.resolve("sent");
      },
    });
    expect(await reloaded.flush()).toBe(false);
    expect(reloaded.pending()).toStrictEqual([answer("c1"), answer("c2")]);
    expect(recorded).toStrictEqual([]);
    now = 20_000;
    expect(await reloaded.flush()).toBe(true);
    expect(await reloaded.flush()).toBe(true);
    expect(recorded).toStrictEqual(["r:f:c1", "r:f:c2"]);
    expect(storage.data.has("k")).toBe(false);
    vi.restoreAllMocks();
  });

  it("removes a deleted card during deferred retry without losing another card or its deadline", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    const storage = memoryStorage();
    const sender = scriptedSender({ status: "failed", retryAt: 20_000 });
    const queue = createAnswerQueue({ key: "k", send: sender.send, storage });
    await queue.enqueue(answer("c1"));
    await queue.enqueue(answer("c2"));
    queue.removeCard("c1");
    const reloaded = createAnswerQueue({ key: "k", send: sender.send, storage });
    expect(reloaded.pending()).toStrictEqual([answer("c2")]);
    expect(await reloaded.flush()).toBe(false);
    expect(sender.sent).toStrictEqual(["c1"]);
    reloaded.removeCard("c2");
    expect(await reloaded.flush()).toBe(true);
    expect(storage.data.has("k")).toBe(false);
    vi.restoreAllMocks();
  });
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
      grade: "hard",
      timedOut: true,
      elapsedMs: 1000,
    };
    const queue = createAnswerQueue({
      key: "k",
      send: scriptedSender().send,
      storage: memoryStorage({ k: JSON.stringify([untimed]) }),
    });
    expect(queue.pending()).toStrictEqual([untimed]);
  });

  it.each([
    ["ok", "good", false],
    ["ng", "again", false],
    ["timeout", "again", true],
  ] as const)(
    "reads an earlier build's stored result %s as the server does: %s, timed out %s",
    (result, grade, timedOut) => {
      const { id, roundId, cardId, pass, elapsedMs, answeredAt } = answer("c1");
      const stored = { id, roundId, cardId, pass, result, elapsedMs, answeredAt };
      const queue = createAnswerQueue({
        key: "k",
        send: scriptedSender().send,
        storage: memoryStorage({ k: JSON.stringify([stored]) }),
      });
      expect(queue.pending()).toStrictEqual([{ ...answer("c1"), grade, timedOut }]);
    },
  );

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
      "an answer with an unknown grade",
      JSON.stringify([{ ...answer("c1"), grade: "easy" }]),
    ],
    [
      "an answer with a grade but no timeout flag",
      JSON.stringify([{ ...answer("c1"), timedOut: "no" }]),
    ],
    [
      "an answer with an unknown result in place of a grade",
      JSON.stringify([
        {
          id: "r:f:c1",
          roundId: "r",
          cardId: "c1",
          pass: "first",
          result: "maybe",
          elapsedMs: 1,
        },
      ]),
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

function listed(initial: Record<string, string>): ListedStorage & {
  readonly data: Map<string, string>;
} {
  const storage = memoryStorage(initial);
  return {
    ...storage,
    get length() {
      return storage.data.size;
    },
    key: (index) => [...storage.data.keys()][index] ?? null,
  };
}

describe("flushEarlierRounds", () => {
  it.each([
    ["sent", true],
    ["failed", false],
  ] as const)(
    "awaits a shared in-flight %s flush and reports %s to both arrivals",
    async (outcome, empty) => {
      const storage = listed({ "drill-answers:r": JSON.stringify([answer("c1")]) });
      let finish: (value: SendOutcome) => void = () => undefined;
      const sending = new Promise<SendOutcome>((resolve) => {
        finish = resolve;
      });
      const sender = scriptedSender();
      const send = (item: AnswerInput) => {
        void sender.send(item);
        return sending;
      };
      const options = { currentId: "new", send, storage };
      const first = flushEarlierRounds(options);
      const second = flushEarlierRounds(options);
      let arrived = 0;
      void first.then(() => {
        arrived += 1;
      });
      void second.then(() => {
        arrived += 1;
      });
      await Promise.resolve();
      expect(arrived).toBe(0);
      expect(sender.sent).toStrictEqual(["c1"]);
      finish(outcome);
      expect(await Promise.all([first, second])).toStrictEqual([empty, empty]);
      expect(storage.data.has("drill-answers:r")).toBe(!empty);
    },
  );
  const stored = (...cards: string[]): string =>
    JSON.stringify(cards.map((cardId) => answer(cardId)));

  it("sends an earlier round's answers under their fixed ids and clears its key", async () => {
    const storage = listed({ "drill-answers:r": stored("c1", "c2") });
    const sent: string[] = [];
    await flushEarlierRounds({
      currentId: "new",
      send: (item) => {
        sent.push(item.id);
        return Promise.resolve("sent");
      },
      storage,
    });
    expect(sent).toStrictEqual(["r:f:c1", "r:f:c2"]);
    expect(storage.data.has("drill-answers:r")).toBe(false);
  });

  it("clears a round the server refuses, as a finished one is", async () => {
    const storage = listed({ "drill-answers:r": stored("c1", "c2") });
    const sender = scriptedSender("rejected", "rejected");
    await flushEarlierRounds({ currentId: "new", send: sender.send, storage });
    expect(storage.data.has("drill-answers:r")).toBe(false);
  });

  it("keeps what failed to send for the next arrival", async () => {
    const storage = listed({ "drill-answers:r": stored("c1", "c2") });
    const sender = scriptedSender("failed");
    expect(
      await flushEarlierRounds({ currentId: "new", send: sender.send, storage }),
    ).toBe(false);
    expect(sender.sent).toStrictEqual(["c1"]);
    expect(storage.data.get("drill-answers:r")).toBe(stored("c1", "c2"));
  });

  it("reports a partial failure and preserves only the unsent tail for retry", async () => {
    const storage = listed({ "drill-answers:r": stored("c1", "c2") });
    const sender = scriptedSender("sent", "failed", "sent");
    expect(
      await flushEarlierRounds({ currentId: "new", send: sender.send, storage }),
    ).toBe(false);
    expect(storage.data.get("drill-answers:r")).toBe(stored("c2"));
    expect(
      await flushEarlierRounds({ currentId: "new", send: sender.send, storage }),
    ).toBe(true);
    expect(sender.sent).toStrictEqual(["c1", "c2", "c2"]);
    expect(storage.data.has("drill-answers:r")).toBe(false);
  });
  it("clears an unreadable key without a request, and leaves the current round and other keys alone", async () => {
    const storage = listed({
      "drill-answers:r": "not json",
      "drill-answers:new": stored("c1"),
      other: "x",
    });
    const sender = scriptedSender();
    await flushEarlierRounds({ currentId: "new", send: sender.send, storage });
    expect(sender.sent).toStrictEqual([]);
    expect([...storage.data.keys()]).toStrictEqual(["drill-answers:new", "other"]);
  });
});

describe("removing pending answers for a deleted card", () => {
  it("preserves unrelated answers and storage when a deleted card had failed resends", async () => {
    const storage = memoryStorage({ k: JSON.stringify([answer("c1"), answer("c2")]) });
    const sender = scriptedSender("failed", "sent");
    const queue = createAnswerQueue({ key: "k", send: sender.send, storage });
    expect(await queue.flush()).toBe(false);
    queue.removeCard("c1");
    expect(queue.pending()).toStrictEqual([answer("c2")]);
    expect(JSON.parse(storage.data.get("k") ?? "[]")).toStrictEqual([answer("c2")]);
    expect(await queue.flush()).toBe(true);
    expect(sender.sent).toStrictEqual(["c1", "c2"]);
    expect(storage.data.has("k")).toBe(false);
  });
  it("does not shift away an unrelated answer when removal races an in-flight send", async () => {
    let resolve!: (value: SendOutcome) => void;
    const sent: string[] = [];
    const queue = createAnswerQueue({
      key: "k",
      send: (item) => {
        sent.push(item.cardId);
        return item.cardId === "c1"
          ? new Promise<SendOutcome>((done) => {
              resolve = done;
            })
          : Promise.resolve("sent");
      },
    });
    const first = queue.enqueue(answer("c1"));
    await Promise.resolve();
    const second = queue.enqueue(answer("c2"));
    queue.removeCard("c1");
    resolve("failed");
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(sent).toStrictEqual(["c1", "c2"]);
    expect(queue.pending()).toStrictEqual([]);
  });
});
