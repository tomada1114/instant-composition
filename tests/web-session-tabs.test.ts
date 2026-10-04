import { beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_COOKIE, SESSION_COOKIE } from "@instant-composition/api";
import { API_ROOT } from "@instant-composition/web";
import { makeWebApi, WEB_ORIGIN } from "./web-session-harness";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function newTab() {
  vi.resetModules();
  const tab = await import("@instant-composition/web");
  tab.beginVisit();
  return tab;
}

function originLocks() {
  let tail = Promise.resolve(undefined);
  const requested: string[] = [];
  const waiting = new Map<number, ReturnType<typeof deferred<undefined>>>();
  return {
    request: <T>(name: string, work: () => Promise<T>) => {
      requested.push(name);
      waiting.get(requested.length)?.resolve(undefined);
      const result = tail.then(work);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    waitForRequest: (count: number) => {
      if (requested.length >= count) return Promise.resolve(undefined);
      const pending = deferred<undefined>();
      waiting.set(count, pending);
      return pending.promise;
    },
  };
}

function connect(web: ReturnType<typeof makeWebApi>) {
  const responses: { path: string; response: Response }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.slice(API_ROOT.length);
    const response = await web.browser.request(init?.method ?? "GET", path, {
      origin: WEB_ORIGIN,
    });
    responses.push({ path, response: response.clone() });
    return response;
  });
  return responses;
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
});

describe("independent tabs sharing cookie authentication", () => {
  it("serializes rotating grants and retries both tabs after one successful renewal", async () => {
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    const web = makeWebApi((fetch) => async (request) => {
      const form = new URLSearchParams(await request.clone().text());
      if (form.get("grant_type") === "refresh_token") {
        entered.resolve(undefined);
        await release.promise;
      }
      return fetch(request);
    });
    await web.signIn();
    const original = web.cognito.last().refresh;
    web.browser.cookies.set(SESSION_COOKIE, "expired.fixture");
    const locks = originLocks();
    vi.stubGlobal("navigator", { locks });
    const first = await newTab();
    const second = await newTab();
    const responses = connect(web);
    const both = Promise.all([first.getHome(), second.getSettings()]);
    await entered.promise;
    await locks.waitForRequest(2);
    release.resolve(undefined);
    expect((await both).map((result) => result.ok)).toStrictEqual([true, true]);
    expect(
      web.cognito.calls.filter((call) => call.form["grant_type"] === "refresh_token"),
    ).toHaveLength(1);
    expect(web.cognito.honours(original)).toBe(false);
    expect(web.browser.cookies.get(REFRESH_COOKIE)).toBe(web.cognito.last().refresh);
    expect(responses.filter(({ path }) => path === "/v1/home")).toHaveLength(2);
    expect(responses.filter(({ path }) => path === "/v1/settings")).toHaveLength(2);
  });

  it("keeps newer cookies when an already-loaded competing client sends a grant that fails late", async () => {
    const entered = deferred<undefined>();
    const release = deferred<undefined>();
    let grants = 0;
    const web = makeWebApi((fetch) => async (request) => {
      const form = new URLSearchParams(await request.clone().text());
      if (form.get("grant_type") === "refresh_token" && ++grants === 1) {
        entered.resolve(undefined);
        await release.promise;
      }
      return fetch(request);
    });
    await web.signIn();
    web.browser.cookies.set(SESSION_COOKIE, "expired.fixture");
    vi.stubGlobal("navigator", { locks: originLocks() });
    const early = await newTab();
    const responses = connect(web);
    const pending = web.browser.request("POST", "/v1/auth/refresh", {
      origin: WEB_ORIGIN,
    });
    await entered.promise;
    expect((await early.getSettings()).ok).toBe(true);
    const updated = new Map(web.browser.cookies);
    release.resolve(undefined);
    const refused = await pending;
    expect(refused.status).toBe(401);
    expect(refused.headers.getSetCookie()).toStrictEqual([]);
    expect(web.browser.cookies).toStrictEqual(updated);
    expect(web.cognito.honours(updated.get(REFRESH_COOKIE) ?? "")).toBe(true);
    const refreshes = responses.filter(({ path }) => path === "/v1/auth/refresh");
    expect(refreshes.map(({ response }) => response.status)).toStrictEqual([204]);
    expect(responses.filter(({ path }) => path === "/v1/settings")).toHaveLength(2);
  });

  it("revokes the renewed token before releasing logout to a waiting tab", async () => {
    const refreshing = deferred<undefined>();
    const finishRefresh = deferred<undefined>();
    const revoking = deferred<string>();
    const finishRevoke = deferred<undefined>();
    const web = makeWebApi((fetch) => async (request) => {
      const form = new URLSearchParams(await request.clone().text());
      if (form.get("grant_type") === "refresh_token") {
        refreshing.resolve(undefined);
        await finishRefresh.promise;
      }
      if (new URL(request.url).pathname === "/oauth2/revoke") {
        revoking.resolve(form.get("token") ?? "");
        await finishRevoke.promise;
      }
      return fetch(request);
    });
    await web.signIn();
    web.browser.cookies.set(SESSION_COOKIE, "expired.fixture");
    const locks = originLocks();
    vi.stubGlobal("navigator", { locks });
    const renewingTab = await newTab();
    const leavingTab = await newTab();
    const waitingTab = await newTab();
    const responses = connect(web);
    const hidden = new EventTarget();
    vi.stubGlobal("window", hidden);
    const submitted = deferred<Response>();
    const submit = vi.fn(() => {
      void web.browser
        .request("POST", "/v1/auth/logout", { origin: WEB_ORIGIN })
        .then(submitted.resolve);
    });
    vi.stubGlobal(
      "HTMLFormElement",
      class {
        submit = submit;
      },
    );
    Object.defineProperty(HTMLFormElement.prototype, "submit", { value: submit });
    const renewing = renewingTab.getHome();
    await refreshing.promise;
    const leaving = leavingTab.signOut(new HTMLFormElement());
    await locks.waitForRequest(2);
    expect(submit).not.toHaveBeenCalled();
    finishRefresh.resolve(undefined);
    try {
      expect((await renewing).ok).toBe(true);
      expect(await revoking.promise).toBe(web.cognito.last().refresh);
      web.browser.cookies.set(SESSION_COOKIE, "expired.fixture");
      const waiting = waitingTab.getSettings();
      await locks.waitForRequest(3);
      expect(
        web.cognito.calls.filter((call) => call.form["grant_type"] === "refresh_token"),
      ).toHaveLength(1);
      finishRevoke.resolve(undefined);
      expect((await submitted.promise).status).toBe(303);
      hidden.dispatchEvent(new Event("pagehide"));
      await leaving;
      expect(await waiting).toStrictEqual({
        ok: false,
        error: { code: "ERR_UNAUTHENTICATED" },
      });
      expect(web.browser.cookies.size).toBe(0);
      expect(web.cognito.honours(web.cognito.last().refresh)).toBe(false);
      expect(
        responses
          .filter(({ path }) => path === "/v1/auth/refresh")
          .map(({ response }) => response.status),
      ).toStrictEqual([204, 401]);
      expect(
        web.cognito.calls.filter((call) => call.form["grant_type"] === "refresh_token"),
      ).toHaveLength(1);
    } finally {
      finishRefresh.resolve(undefined);
      finishRevoke.resolve(undefined);
      hidden.dispatchEvent(new Event("pagehide"));
      await leaving;
    }
  });
});
