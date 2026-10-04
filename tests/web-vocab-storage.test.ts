import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLearnerStorage,
  learnerStorageRevision,
  createPagedOutbox,
  beginVisit,
  getHome,
  signOut,
  type ListedStorage,
} from "@instant-composition/web";
import { outboxLocks, outboxAnswer } from "./paged-outbox-harness";
function storage(): ListedStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("paged vocabulary session invalidation", () => {
  it("clears every outbox page/receipt/removal marker and private checkpoint while retaining unrelated settings", async () => {
    const local = storage();
    const session = storage();
    const locks = outboxLocks();
    vi.stubGlobal("window", { localStorage: local, sessionStorage: session });
    vi.stubGlobal("navigator", { locks });
    for (const key of [
      "vocab-outbox:s",
      "vocab-outbox:s:page:0",
      "vocab-outbox:s:recent",
      "vocab-outbox:s:removed:p_old",
    ])
      local.setItem(key, "private");
    for (const key of ["vocab-active:today:all", "vocab-checkpoint:s"])
      session.setItem(key, "private");
    local.setItem("key-mode", "1");
    session.setItem("unrelated", "retained");
    await clearLearnerStorage();
    expect(
      [...local.values.keys()].some((key) => key.startsWith("vocab-outbox:")),
    ).toBe(false);
    expect([...session.values]).toStrictEqual([["unrelated", "retained"]]);
    expect(local.getItem("key-mode")).toBe("1");
  });
  it("refuses an old outbox instance after invalidation so a late acknowledgement cannot recreate another learner's data", async () => {
    const local = storage();
    const session = storage();
    const locks = outboxLocks();
    vi.stubGlobal("window", { localStorage: local, sessionStorage: session });
    vi.stubGlobal("navigator", { locks });
    const revision = learnerStorageRevision();
    let resolve: (outcome: "sent") => void = () => {
      throw new Error("No pending send.");
    };
    let started: () => void = () => undefined;
    const sending = new Promise<void>((done) => {
      started = done;
    });
    const queue = createPagedOutbox({
      key: "vocab-outbox:old",
      storage: local,
      locks,
      valid: () => learnerStorageRevision() === revision,
      send: () =>
        new Promise((done) => {
          resolve = done;
          started();
        }),
    });
    expect(await queue.append(outboxAnswer(0))).toBe(true);
    const flush = queue.flush();
    await sending;
    await clearLearnerStorage();
    resolve("sent");
    expect(await flush).toBe(false);
    expect(await queue.append(outboxAnswer(1))).toBe(false);
    expect(
      [...local.values.keys()].some((key) => key.startsWith("vocab-outbox:")),
    ).toBe(false);
  });
  it("retains pending bytes on a new visit and unavailable renewal, and clears only a confirmed terminal refusal", async () => {
    const local = storage();
    const session = storage();
    vi.stubGlobal("window", { localStorage: local, sessionStorage: session });
    vi.stubGlobal("navigator", { locks: outboxLocks() });
    local.setItem("vocab-outbox:old", "durable private bytes");
    session.setItem("vocab-checkpoint:old", "saved private state");
    beginVisit();
    const refused = () =>
      Response.json({ error: { code: "ERR_UNAUTHENTICATED" } }, { status: 401 });
    let temporary = true;
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url.endsWith("/refresh") && temporary
          ? new Response(null, { status: 503 })
          : refused(),
      ),
    );
    expect(await getHome()).toStrictEqual({
      ok: false,
      error: { code: "ERR_NETWORK" },
    });
    expect(local.getItem("vocab-outbox:old")).toBe("durable private bytes");
    expect(session.getItem("vocab-checkpoint:old")).toBe("saved private state");
    temporary = false;
    beginVisit();
    expect(await getHome()).toStrictEqual({
      ok: false,
      error: { code: "ERR_UNAUTHENTICATED" },
    });
    expect(local.getItem("vocab-outbox:old")).toBeNull();
    expect(session.getItem("vocab-checkpoint:old")).toBeNull();
  });
  it("invalidates only after a native navigation submission succeeds, in the same locked turn", async () => {
    const local = storage();
    const session = storage();
    vi.stubGlobal("window", { localStorage: local, sessionStorage: session });
    vi.stubGlobal("navigator", { locks: outboxLocks() });
    local.setItem("vocab-outbox:old", "durable");
    await expect(
      clearLearnerStorage(() => {
        throw new Error("submit refused");
      }),
    ).rejects.toThrow("submit refused");
    expect(local.getItem("vocab-outbox:old")).toBe("durable");
    let submitted = false;
    await clearLearnerStorage(() => {
      expect(local.getItem("vocab-outbox:old")).toBe("durable");
      submitted = true;
    });
    expect(submitted).toBe(true);
    expect(local.getItem("vocab-outbox:old")).toBeNull();
  });
  it("clears through exported signOut before pagehide under both locks and fences an old in-flight drain", async () => {
    const local = storage(),
      session = storage(),
      base = outboxLocks();
    const held: string[] = [];
    const locks = {
      request<T>(name: string, work: () => T | Promise<T>): Promise<T> {
        return base.request(name, async () => {
          held.push(name);
          try {
            return await work();
          } finally {
            held.splice(held.indexOf(name), 1);
          }
        });
      },
    };
    const hidden = Object.assign(new EventTarget(), {
      localStorage: local,
      sessionStorage: session,
    });
    vi.stubGlobal("window", hidden);
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("navigator", { locks });
    beginVisit();
    const revision = learnerStorageRevision();
    let finish: (outcome: "sent") => void = () => undefined;
    let entered: () => void = () => undefined;
    const sending = new Promise<void>((done) => {
      entered = done;
    });
    const queue = createPagedOutbox({
      key: "vocab-outbox:old",
      storage: local,
      locks,
      valid: () => learnerStorageRevision() === revision,
      send: () =>
        new Promise((done) => {
          finish = done;
          entered();
        }),
    });
    expect(await queue.append(outboxAnswer(0))).toBe(true);
    session.setItem("vocab-active:today:all", "private");
    session.setItem("vocab-checkpoint:old", "private");
    local.setItem("key-mode", "retained");
    const draining = queue.flush();
    await sending;
    let submitted: () => void = () => undefined;
    const submittedPromise = new Promise<void>((done) => {
      submitted = done;
    });
    const submissionLocks: string[][] = [];
    const submit = vi.fn(() => {
      submissionLocks.push([...held]);
      expect(local.getItem("vocab-outbox:old:page:0")).not.toBeNull();
      submitted();
    });
    vi.stubGlobal(
      "HTMLFormElement",
      class {
        submit = submit;
      },
    );
    Object.defineProperty(HTMLFormElement.prototype, "submit", { value: submit });
    const leaving = signOut(new HTMLFormElement());
    try {
      await submittedPromise;
      expect(submissionLocks).toStrictEqual([
        ["instant-composition-session", "instant-composition-vocab-storage"],
      ]);
      expect(learnerStorageRevision()).not.toBe(revision);
      expect(
        [...local.values.keys()].filter((key) => key.startsWith("vocab-outbox:")),
      ).toStrictEqual([]);
      expect([...session.values]).toStrictEqual([]);
      expect(local.getItem("key-mode")).toBe("retained");
      let renewed = false;
      const renewal = locks.request("instant-composition-session", () => {
        renewed = true;
      });
      finish("sent");
      expect(await draining).toBe(false);
      expect(await queue.append(outboxAnswer(1))).toBe(false);
      expect(renewed).toBe(false);
      hidden.dispatchEvent(new Event("pagehide"));
      await leaving;
      await renewal;
      expect(renewed).toBe(true);
      expect(
        [...local.values.keys()].filter((key) => key.startsWith("vocab-outbox:")),
      ).toStrictEqual([]);
    } finally {
      finish("sent");
      hidden.dispatchEvent(new Event("pagehide"));
      await leaving;
    }
  });
  it("retains exact learner bytes when exported signOut native submit throws, then clears on an explicit retry", async () => {
    const local = storage(),
      session = storage();
    const hidden = Object.assign(new EventTarget(), {
      localStorage: local,
      sessionStorage: session,
    });
    vi.stubGlobal("window", hidden);
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("navigator", { locks: outboxLocks() });
    beginVisit();
    local.setItem("vocab-outbox:old:page:0", "private answers");
    session.setItem("vocab-checkpoint:old", "private state");
    const before = [...local.values],
      beforeSession = [...session.values];
    let submitted: () => void = () => undefined;
    const submittedPromise = new Promise<void>((done) => {
      submitted = done;
    });
    const submit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("fixture submit refused");
      })
      .mockImplementation(submitted);
    vi.stubGlobal(
      "HTMLFormElement",
      class {
        submit = submit;
      },
    );
    Object.defineProperty(HTMLFormElement.prototype, "submit", { value: submit });
    const form = new HTMLFormElement();
    await signOut(form);
    expect([...local.values]).toStrictEqual(before);
    expect([...session.values]).toStrictEqual(beforeSession);
    const leaving = signOut(form);
    try {
      await submittedPromise;
      expect(local.getItem("vocab-outbox:old:page:0")).toBeNull();
      expect(session.getItem("vocab-checkpoint:old")).toBeNull();
      expect(submit).toHaveBeenCalledTimes(2);
    } finally {
      hidden.dispatchEvent(new Event("pagehide"));
      await leaving;
    }
  });
});
