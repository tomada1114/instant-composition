import { describe, expect, it, vi } from "vitest";
import { REFRESH_COOKIE, SESSION_COOKIE } from "@instant-composition/api";
import { beginVisit, getHome, getSettings } from "@instant-composition/web";
import { makeWebApi, WEB_ORIGIN } from "./web-session-harness";

/** Controlled signed JWTs and OAuth provider; a fixture cookie map, never a real browser jar. */
function connectSession(web: ReturnType<typeof makeWebApi>) {
  const responses: { path: string; response: Response }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/u, "");
    const response = await web.browser.request(init?.method ?? "GET", path, {
      origin: WEB_ORIGIN,
    });
    responses.push({ path, response: response.clone() });
    return response;
  });
  return responses;
}

describe("concurrent client queries through actual cookie auth HTTP endpoints", () => {
  it("renews one rotating refresh grant for concurrent reads and replays both with the issued cookies", async () => {
    const web = makeWebApi();
    await web.signIn();
    const original = web.cognito.last().refresh;
    web.browser.cookies.set(SESSION_COOKIE, "expired.fixture");
    beginVisit();
    const responses = connectSession(web);
    const result = await Promise.all([getHome(), getSettings()]);
    expect(result.map((answer) => answer.ok)).toStrictEqual([true, true]);
    expect(
      web.cognito.calls.filter((call) => call.form["grant_type"] === "refresh_token"),
    ).toHaveLength(1);
    expect(web.cognito.honours(original)).toBe(false);
    expect(web.browser.cookies.get(REFRESH_COOKIE)).toBe(web.cognito.last().refresh);
    const refreshed = responses.filter(({ path }) => path === "/v1/auth/refresh");
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.response.status).toBe(204);
    expect(refreshed[0]?.response.headers.getSetCookie()).toStrictEqual([
      `${SESSION_COOKIE}=${web.cognito.last().access}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`,
      `${REFRESH_COOKIE}=${web.cognito.last().refresh}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ]);
  });

  it("exposes an expired refresh as unauthenticated without deleting credentials a racing response might have renewed", async () => {
    const web = makeWebApi();
    await web.signIn();
    web.browser.cookies.set(SESSION_COOKIE, "expired.fixture");
    web.browser.cookies.set(REFRESH_COOKIE, "revoked.fixture");
    const cookies = new Map(web.browser.cookies);
    beginVisit();
    const responses = connectSession(web);
    expect(await getHome()).toStrictEqual({
      ok: false,
      error: { code: "ERR_UNAUTHENTICATED" },
    });
    expect(web.browser.cookies).toStrictEqual(cookies);
    expect(
      responses
        .find(({ path }) => path === "/v1/auth/refresh")
        ?.response.headers.getSetCookie(),
    ).toStrictEqual([]);
  });

  it("deletes both cookie credentials with secure attributes on explicit logout", async () => {
    const web = makeWebApi();
    await web.signIn();
    const response = await web.browser.request("POST", "/v1/auth/logout", {
      origin: WEB_ORIGIN,
    });
    expect(response.status).toBe(303);
    expect([...web.browser.cookies]).toStrictEqual([]);
    expect(response.headers.getSetCookie()).toStrictEqual([
      `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
      `${REFRESH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ]);
  });

  it.each([null, 503] as const)(
    "keeps the refresh credential and exposes provider unavailability (%s) without treating it as sign-out",
    async (broken) => {
      const web = makeWebApi();
      await web.signIn();
      web.browser.cookies.set(SESSION_COOKIE, "expired.fixture");
      const cookies = new Map(web.browser.cookies);
      web.cognito.breakWith(broken);
      beginVisit();
      connectSession(web);
      expect(await getHome()).toStrictEqual({
        ok: false,
        error: { code: "ERR_NETWORK" },
      });
      expect(web.browser.cookies).toStrictEqual(cookies);
    },
  );

  it("returns a retryable network error during an established visit without redirecting to login", async () => {
    const web = makeWebApi();
    await web.signIn();
    beginVisit();
    connectSession(web);
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    expect((await getHome()).ok).toBe(true);
    web.browser.cookies.set(SESSION_COOKIE, "expired.fixture");
    web.cognito.breakWith(503);
    expect(await getHome()).toStrictEqual({
      ok: false,
      error: { code: "ERR_NETWORK" },
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([{}, { origin: "https://foreign.example" }])(
    "refuses a refresh from a missing or foreign Origin before touching provider or cookies: %j",
    async (headers) => {
      const web = makeWebApi();
      await web.signIn();
      const cookies = new Map(web.browser.cookies);
      const calls = web.cognito.calls.length;
      const response = await web.browser.request("POST", "/v1/auth/refresh", headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "ERR_FORBIDDEN" } });
      expect(response.headers.getSetCookie()).toStrictEqual([]);
      expect(web.browser.cookies).toStrictEqual(cookies);
      expect(web.cognito.calls).toHaveLength(calls);
    },
  );
});
