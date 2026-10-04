import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginVisit,
  createAnswerQueue,
  getHome,
  getSettings,
  recordAnswers,
  REFRESH_URL,
  signOut,
  type AnswerInput,
} from "@instant-composition/web";
import { outboxLocks } from "./paged-outbox-harness";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function unauthenticated(): Response {
  return Response.json({ error: { code: "ERR_UNAUTHENTICATED" } }, { status: 401 });
}
function setup(): void {
  vi.stubGlobal("navigator", { locks: outboxLocks() });
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  beginVisit();
}
beforeEach(setup);

describe("shared cookie renewal", () => {
  it("replays each concurrently refused original request exactly once after one renewal", async () => {
    const renewal = deferred<Response>();
    const accepted = deferred<undefined>();
    const calls: string[] = [];
    let renewed = false;
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      if (url === REFRESH_URL) {
        accepted.resolve(undefined);
        return renewal.promise;
      }
      return Promise.resolve(renewed ? Response.json({}) : unauthenticated());
    });
    const both = Promise.all([getHome(), getSettings()]);
    await accepted.promise;
    renewed = true;
    renewal.resolve(new Response(null, { status: 204 }));
    expect((await both).map((result) => result.ok)).toStrictEqual([true, true]);
    expect(calls.filter((url) => url === REFRESH_URL)).toHaveLength(1);
    expect(calls.filter((url) => url === "/api/v1/home")).toHaveLength(2);
    expect(calls.filter((url) => url === "/api/v1/settings")).toHaveLength(2);
  });

  it.each([204, 503])(
    "shares a completed %i renewal with a delayed original 401",
    async (status) => {
      const late = deferred<Response>();
      const calls: string[] = [];
      let renewed = false;
      vi.stubGlobal("fetch", (url: string) => {
        calls.push(url);
        if (url === REFRESH_URL) {
          renewed = status === 204;
          return Promise.resolve(new Response(null, { status }));
        }
        if (
          url === "/api/v1/settings" &&
          calls.filter((name) => name === url).length === 1
        )
          return late.promise;
        return Promise.resolve(renewed ? Response.json({}) : unauthenticated());
      });
      const early = getHome();
      const pending = getSettings();
      const first = await early;
      late.resolve(unauthenticated());
      expect((await pending).ok).toBe(first.ok);
      expect(calls.filter((url) => url === REFRESH_URL)).toHaveLength(1);
      expect(calls.filter((url) => url === "/api/v1/settings")).toHaveLength(
        status === 204 ? 2 : 1,
      );
    },
  );

  it("shares a renewal across app visits while preventing the previous visit's replay", async () => {
    const renewal = deferred<Response>();
    const accepted = deferred<undefined>();
    const calls: string[] = [];
    let renewed = false;
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      if (url === REFRESH_URL) {
        accepted.resolve(undefined);
        return renewal.promise;
      }
      return Promise.resolve(renewed ? Response.json({}) : unauthenticated());
    });
    const previous = getHome();
    await accepted.promise;
    beginVisit();
    const current = getSettings();
    renewed = true;
    renewal.resolve(new Response(null, { status: 204 }));
    expect(await previous).toStrictEqual({
      ok: false,
      error: { code: "ERR_UNAUTHENTICATED" },
    });
    expect((await current).ok).toBe(true);
    expect(calls.filter((url) => url === REFRESH_URL)).toHaveLength(1);
    expect(calls.filter((url) => url === "/api/v1/home")).toHaveLength(1);
    expect(calls.filter((url) => url === "/api/v1/settings")).toHaveLength(2);
  });

  it("still shares renewal when browser storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked fixture");
      },
      setItem: () => {
        throw new Error("blocked fixture");
      },
    });
    const renewal = deferred<Response>();
    const accepted = deferred<undefined>();
    const calls: string[] = [];
    let renewed = false;
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      if (url === REFRESH_URL) {
        accepted.resolve(undefined);
        return renewal.promise;
      }
      return Promise.resolve(renewed ? Response.json({}) : unauthenticated());
    });
    const results = Promise.all([getHome(), getSettings()]);
    await accepted.promise;
    renewed = true;
    renewal.resolve(new Response(null, { status: 204 }));
    expect((await results).map((result) => result.ok)).toStrictEqual([true, true]);
    expect(calls.filter((url) => url === REFRESH_URL)).toHaveLength(1);
  });

  it.each(["network", "503", "malformed401", "unknown401", "403"])(
    "keeps queued answers and the visit on temporary renewal failure %s",
    async (failure) => {
      vi.stubGlobal("fetch", () => Promise.resolve(Response.json({})));
      expect((await getHome()).ok).toBe(true);
      const assign = vi.fn();
      vi.stubGlobal("location", { assign });
      vi.stubGlobal("fetch", (url: string) =>
        url !== REFRESH_URL
          ? Promise.resolve(unauthenticated())
          : failure === "network"
            ? Promise.reject(new Error("fixture"))
            : Promise.resolve(
                new Response(
                  failure === "malformed401"
                    ? "invalid"
                    : failure === "unknown401"
                      ? JSON.stringify({ error: { code: "ERR_OTHER" } })
                      : null,
                  {
                    status:
                      failure === "503" ? 503 : failure.endsWith("401") ? 401 : 403,
                  },
                ),
              ),
      );
      const data = new Map<string, string>();
      const storage = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
        removeItem: (key: string) => {
          data.delete(key);
        },
      };
      const answer: AnswerInput = {
        id: "fixed-id",
        roundId: "r",
        cardId: "c1",
        pass: "first",
        grade: "good",
        timedOut: false,
        elapsedMs: 1000,
      };
      const send = (value: AnswerInput) => recordAnswers(value.roundId, [value]);
      const queue = createAnswerQueue({ key: "fixture", send, storage });
      expect(await queue.enqueue(answer)).toBe(false);
      const restored = createAnswerQueue({ key: "fixture", send, storage });
      expect(restored.pending()).toStrictEqual([answer]);
      expect(assign).not.toHaveBeenCalled();
      const retried: unknown[] = [];
      vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
        retried.push(
          typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null,
        );
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      expect(await restored.flush()).toBe(true);
      expect(retried).toStrictEqual([
        {
          answers: [
            {
              id: "fixed-id",
              roundId: "r",
              cardId: "c1",
              pass: "first",
              grade: "good",
              timedOut: false,
              elapsedMs: 1000,
            },
          ],
        },
      ]);
      expect(restored.pending()).toStrictEqual([]);
      expect(data.size).toBe(0);
    },
  );

  it("waits for an in-flight renewal before native sign-out and ignores its stale API replay", async () => {
    const renewal = deferred<Response>();
    const accepted = deferred<undefined>();
    const submit = vi.fn();
    const hidden = new EventTarget();
    vi.stubGlobal("window", hidden);
    vi.stubGlobal(
      "HTMLFormElement",
      class {
        submit = submit;
      },
    );
    // Native submit is invoked through the prototype, as a real form is.
    Object.defineProperty(HTMLFormElement.prototype, "submit", { value: submit });
    const requests: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      requests.push(url);
      if (url === REFRESH_URL) {
        accepted.resolve(undefined);
        return renewal.promise;
      }
      return Promise.resolve(unauthenticated());
    });
    const pending = getHome();
    await accepted.promise;
    const leaving = signOut(new HTMLFormElement());
    expect(submit).not.toHaveBeenCalled();
    renewal.resolve(new Response(null, { status: 204 }));
    expect(await pending).toStrictEqual({
      ok: false,
      error: { code: "ERR_UNAUTHENTICATED" },
    });
    await vi.waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    expect(requests).toStrictEqual(["/api/v1/home", REFRESH_URL]);
    hidden.dispatchEvent(new Event("pagehide"));
    await leaving;
  });

  it("allows sign-out to be retried when native form submission throws", async () => {
    const hidden = new EventTarget();
    const submitted = deferred<undefined>();
    const submit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("fixture");
      })
      .mockImplementation(() => {
        submitted.resolve(undefined);
      });
    vi.stubGlobal("window", hidden);
    vi.stubGlobal(
      "HTMLFormElement",
      class {
        submit = submit;
      },
    );
    Object.defineProperty(HTMLFormElement.prototype, "submit", { value: submit });
    const form = new HTMLFormElement();
    await expect(signOut(form)).resolves.toBeUndefined();
    const retry = signOut(form);
    await submitted.promise;
    hidden.dispatchEvent(new Event("pagehide"));
    await expect(retry).resolves.toBeUndefined();
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
