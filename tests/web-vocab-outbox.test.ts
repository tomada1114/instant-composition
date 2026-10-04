import { describe, expect, it } from "vitest";
import { createPagedOutbox, type AnswerInput } from "@instant-composition/web";
import { outboxLocks, outboxStorage, outboxAnswer } from "./paged-outbox-harness";

describe("the durable paged vocabulary outbox", () => {
  it("keeps2500 unsent answers in20-entry records, loads fixed pages, and flushes them with the original identities after reload", async () => {
    const storage = outboxStorage();
    const locks = outboxLocks();
    const first = createPagedOutbox({
      key: "outbox",
      storage,
      locks,
      send: () => Promise.resolve("failed"),
    });
    for (let index = 0; index < 2500; index += 1)
      expect(await first.append(outboxAnswer(index))).toBe(true);
    expect(first.count()).toBe(2500);
    expect(await first.flush()).toBe(false);
    expect(storage.largest()).toBeLessThanOrEqual(20);
    expect([...storage.values].filter(([key]) => key.includes(":page:"))).toHaveLength(
      125,
    );
    const received: string[] = [];
    let largestSend = 0;
    const restored = createPagedOutbox({
      key: "outbox",
      storage,
      locks,
      send: (answers) => {
        largestSend = Math.max(largestSend, answers.length);
        received.push(...answers.map((answer) => answer.id));
        return Promise.resolve("sent" as const);
      },
    });
    expect(await restored.flush()).toBe(true);
    expect(restored.count()).toBe(0);
    expect(largestSend).toBeLessThanOrEqual(20);
    expect(received).toStrictEqual(
      Array.from({ length: 2500 }, (_, index) => outboxAnswer(index).id),
    );
    expect([...storage.values].filter(([key]) => key.includes(":page:"))).toHaveLength(
      0,
    );
  });
  it("serializes two document instances appending and draining the same durable pages", async () => {
    const storage = outboxStorage();
    const locks = outboxLocks();
    const accepted = new Set<string>();
    const send = (answers: readonly AnswerInput[]) => {
      for (const answer of answers) accepted.add(answer.id);
      return Promise.resolve("sent" as const);
    };
    const one = createPagedOutbox({ key: "shared", storage, locks, send });
    const two = createPagedOutbox({ key: "shared", storage, locks, send });
    expect(
      await Promise.all(
        Array.from({ length: 81 }, (_, index) =>
          (index % 2 === 0 ? one : two).append(outboxAnswer(index)),
        ),
      ),
    ).toStrictEqual(Array<boolean>(81).fill(true));
    expect(one.count()).toBe(81);
    expect(await Promise.all([one.flush(), two.flush()])).toStrictEqual([true, true]);
    expect(accepted.size).toBe(81);
    expect(two.count()).toBe(0);
  });
  it("recovers a durable append interrupted before metadata without duplicating or skipping it", async () => {
    const storage = outboxStorage();
    const locks = outboxLocks();
    let writes = 0;
    const crashing = {
      ...storage,
      setItem(key: string, value: string) {
        if (key === "crash" && ++writes === 2) {
          throw new Error("Quota failure after page save.");
        }
        storage.setItem(key, value);
      },
    };
    const one = createPagedOutbox({
      key: "crash",
      storage: crashing,
      locks,
      send: () => Promise.resolve("failed"),
    });
    expect(await one.append(outboxAnswer(0))).toBe(false);
    const received: string[] = [];
    const two = createPagedOutbox({
      key: "crash",
      storage,
      locks,
      send: (answers) => {
        received.push(...answers.map((answer) => answer.id));
        return Promise.resolve("sent" as const);
      },
    });
    expect(await two.append(outboxAnswer(0))).toBe(true);
    expect(two.count()).toBe(1);
    expect(await two.flush()).toBe(true);
    expect(received).toStrictEqual([outboxAnswer(0).id]);
  });
  it("retains a lost204 or409 conflict for replay and fails closed without Web Locks while preserving bytes", async () => {
    const storage = outboxStorage();
    const locks = outboxLocks();
    let delivered = false;
    const accepted = new Set<string>();
    const one = createPagedOutbox({
      key: "replay",
      storage,
      locks,
      send: (answers) => {
        for (const answer of answers) accepted.add(answer.id);
        return Promise.resolve(delivered ? ("sent" as const) : ("failed" as const));
      },
    });
    expect(await one.append(outboxAnswer(0))).toBe(true);
    expect(await one.flush()).toBe(false);
    const before = [...storage.values];
    const unsupported = createPagedOutbox({
      key: "replay",
      storage,
      locks: undefined,
      send: () => Promise.resolve("sent"),
    });
    expect(await unsupported.append(outboxAnswer(1))).toBe(false);
    expect(await unsupported.flush()).toBe(false);
    expect([...storage.values]).toStrictEqual(before);
    delivered = true;
    expect(await one.flush()).toBe(true);
    expect(accepted.size).toBe(1);
    expect(one.count()).toBe(0);
  });
});

describe("held durable outbox metadata", () => {
  const empty = { head: 0, tail: 0, offset: 0, tailLength: 0, count: 0, retryAt: 0 };
  it.each([
    { ...empty, future: 1 },
    { ...empty, count: 1 },
    { ...empty, offset: 1 },
    { ...empty, head: 1, tail: 1, tailLength: 1, count: 1 },
    { ...empty, tail: 1, count: 20 },
  ])("holds unreadable metadata and all original bytes: %j", async (meta) => {
    const storage = outboxStorage();
    storage.setItem("held", JSON.stringify(meta));
    const before = [...storage.values];
    const sent: string[] = [];
    const queue = createPagedOutbox({
      key: "held",
      storage,
      locks: outboxLocks(),
      send: (answers) => {
        sent.push(...answers.map((answer) => answer.id));
        return Promise.resolve("sent" as const);
      },
    });
    expect(await queue.flush()).toBe(false);
    expect(await queue.append(outboxAnswer(0))).toBe(false);
    await queue.deferUntil(100);
    expect(await queue.tail()).toStrictEqual([]);
    expect(await queue.removeCard("v_0")).toBe(false);
    expect(sent).toStrictEqual([]);
    expect([...storage.values]).toStrictEqual(before);
  });
  it("accepts an advanced empty checkpoint and recovers its interrupted append with original identity", async () => {
    const storage = outboxStorage();
    storage.setItem("advanced", JSON.stringify({ ...empty, head: 7, tail: 7 }));
    const received: string[] = [];
    const queue = createPagedOutbox({
      key: "advanced",
      storage,
      locks: outboxLocks(),
      send: (answers) => {
        received.push(...answers.map((answer) => answer.id));
        return Promise.resolve("sent" as const);
      },
    });
    expect(await queue.flush()).toBe(true);
    storage.setItem("advanced:page:7", JSON.stringify([outboxAnswer(0)]));
    expect(queue.count()).toBe(0);
    expect(await queue.flush()).toBe(true);
    expect(received).toStrictEqual([outboxAnswer(0).id]);
    expect(queue.count()).toBe(0);
  });
});

describe("durable page consistency before recovery writes", () => {
  it("recovers a full-tail rollover interrupted before its checkpoint", async () => {
    const storage = outboxStorage();
    const answers = Array.from({ length: 21 }, (_, index) => outboxAnswer(index));
    storage.setItem(
      "rollover",
      JSON.stringify({
        head: 0,
        tail: 0,
        offset: 0,
        tailLength: 20,
        count: 20,
        retryAt: 0,
      }),
    );
    storage.setItem("rollover:page:0", JSON.stringify(answers.slice(0, 20)));
    storage.setItem("rollover:page:1", JSON.stringify(answers.slice(20)));
    const received: string[] = [];
    const queue = createPagedOutbox({
      key: "rollover",
      storage,
      locks: outboxLocks(),
      send: (batch) => {
        received.push(...batch.map((answer) => answer.id));
        return Promise.resolve("sent" as const);
      },
    });
    expect(await queue.flush()).toBe(true);
    expect(received).toStrictEqual(answers.map((answer) => answer.id));
    expect(queue.count()).toBe(0);
  });
  it("does not rewrite a recoverable tail when its pending head is missing", async () => {
    const storage = outboxStorage();
    storage.setItem(
      "missing-head",
      JSON.stringify({
        head: 0,
        tail: 1,
        offset: 0,
        tailLength: 1,
        count: 21,
        retryAt: 0,
      }),
    );
    storage.setItem(
      "missing-head:page:1",
      JSON.stringify([outboxAnswer(20), outboxAnswer(21)]),
    );
    const before = [...storage.values];
    let sent = 0;
    const queue = createPagedOutbox({
      key: "missing-head",
      storage,
      locks: outboxLocks(),
      send: () => {
        sent += 1;
        return Promise.resolve("sent" as const);
      },
    });
    expect(await queue.flush()).toBe(false);
    expect(await queue.removeCard("v_20")).toBe(false);
    expect(sent).toBe(0);
    expect([...storage.values]).toStrictEqual(before);
  });
});
