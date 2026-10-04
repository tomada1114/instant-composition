import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLearnerStorage,
  learnerStorageRevision,
  createPagedOutbox,
  beginVisit,
  getHome,
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
});
