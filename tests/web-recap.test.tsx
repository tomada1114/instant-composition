import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeView, RoundSummary } from "@instant-composition/web";

import {
  COUNT,
  fakeApi,
  fakeTimers,
  homeView,
  ja,
  press,
  refusal,
  renderApp,
  settle,
  type ApiCall,
} from "./web-harness";
import { makeSummary } from "./web-summary-fixture";

// The recap screen, W9r, mounted as the whole app at `/recap` over a stand-in
// API: it reads back the summary of the round the home view names as today's
// last finished one, with every value final, and hands over to the start
// screen when there is none. Nothing about the round is kept in the browser.

const HOME_URL = "/api/v1/home";
const SUMMARY_URL = "/api/v1/rounds/r7/summary";
const DONE = { kind: "done", restoresTo: null, streak: COUNT } as const;

/** Today's portion done, with round `r7` finished last. */
const FINISHED_R7 = homeView(DONE, { todayLastRoundId: "r7" });

/** Today's portion done, with no round finished today named. */
const NONE_NAMED = homeView(DONE);

/** An API that answers `home` for the home view and `summary` for round `r7`'s summary. */
function serveRecap({
  home = () => Response.json(FINISHED_R7),
  summary = () => Response.json(makeSummary({ roundId: "r7" })),
}: {
  home?: (call: ApiCall) => Response | Promise<Response>;
  summary?: (call: ApiCall) => Response | Promise<Response>;
} = {}): ApiCall[] {
  return fakeApi((call) => {
    if (call.method === "GET" && call.url === HOME_URL) return home(call);
    if (call.method === "GET" && call.url === SUMMARY_URL) return summary(call);
    return undefined;
  });
}

/** Answers each home read with the next of `views`, the last one from then on. */
function homeSequence(...views: HomeView[]): () => Response {
  let read = 0;
  return () => {
    const view = views[Math.min(read, views.length - 1)];
    read += 1;
    return Response.json(view);
  };
}

function where(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function readsOf(calls: readonly ApiCall[], url: string): number {
  return calls.filter((call) => call.url === url).length;
}

function expectRecap(): void {
  expect(
    screen.getByRole("heading", { level: 1, name: ja.Summary.title.recap }),
  ).toBeInTheDocument();
}

beforeEach(() => {
  fakeTimers();
  // Motion allowed: a live summary would count up, so a final value on the
  // first frame is the recap's doing.
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  localStorage.clear();
  act(() => {
    window.history.replaceState(null, "", "/");
  });
});

describe("the recap screen, W9r: re-reading today", () => {
  it("reads back the round the home view names, every value final, with no buttons below", async () => {
    const calls = serveRecap();
    await renderApp("/recap");
    expectRecap();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(readsOf(calls, SUMMARY_URL)).toBe(1);
    expect(
      screen.queryByRole("button", { name: ja.Summary.actions.end }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /もう/u })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ja.Summary.close }),
    ).not.toBeInTheDocument();
  });

  it("reads back a round finished in another browser, keeping nothing in this one", async () => {
    expect(localStorage).toHaveLength(0);
    const calls = serveRecap();
    await renderApp("/recap");
    expectRecap();
    expect(readsOf(calls, SUMMARY_URL)).toBe(1);
    expect(localStorage).toHaveLength(0);
  });

  it("reads back the round even where storage cannot be read or written", async () => {
    const throwing = (): never => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", {
      getItem: throwing,
      setItem: throwing,
      removeItem: throwing,
      clear: () => undefined,
    });
    const calls = serveRecap();
    await renderApp("/recap");
    expectRecap();
    expect(readsOf(calls, SUMMARY_URL)).toBe(1);
  });

  it("reads the home view again for this visit rather than acting on a cached one", async () => {
    const calls = serveRecap({ home: homeSequence(NONE_NAMED, FINISHED_R7) });
    await renderApp("/");
    fireEvent.click(screen.getByRole("link", { name: ja.Home.done.recap }));
    await settle();
    await settle(16);
    expect(where()).toBe("/recap");
    expectRecap();
    expect(readsOf(calls, HOME_URL)).toBe(2);
  });

  it("goes back on ←", async () => {
    serveRecap();
    await renderApp("/recap");
    const back = screen.getByRole("link", { name: ja.Summary.back });
    expect(back).toHaveAttribute("href", "/");
    fireEvent.click(back);
    await settle();
    expect(where()).toBe("/");
  });

  it("goes back on Esc", async () => {
    serveRecap();
    await renderApp("/recap");
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });
});

describe("the recap screen with nothing to read back", () => {
  it("goes to the start screen when the home view names no round finished today", async () => {
    const calls = serveRecap({ home: () => Response.json(NONE_NAMED) });
    await renderApp("/recap");
    expect(where()).toBe("/");
    expect(readsOf(calls, SUMMARY_URL)).toBe(0);
  });

  it.each([
    [404, "ERR_ROUND_NOT_FOUND"],
    [400, "ERR_BAD_REQUEST"],
  ] as const)(
    "goes to the start screen when the summary read answers %i %s",
    async (status, code) => {
      serveRecap({ summary: () => refusal(status, code) });
      await renderApp("/recap");
      expect(where()).toBe("/");
    },
  );
});

describe("the recap screen when a read fails", () => {
  it("says so when the home view cannot be read, and reads it again on request", async () => {
    let attempts = 0;
    const calls = serveRecap({
      home: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError("fetch failed"))
          : Response.json(FINISHED_R7);
      },
    });
    await renderApp("/recap");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    expect(readsOf(calls, SUMMARY_URL)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    await settle(16);
    expectRecap();
    expect(readsOf(calls, HOME_URL)).toBe(2);
  });

  it("says so when the summary cannot be read, and reads it again on request", async () => {
    let attempts = 0;
    const calls = serveRecap({
      summary: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError("fetch failed"))
          : Response.json(makeSummary({ roundId: "r7" }) satisfies RoundSummary);
      },
    });
    await renderApp("/recap");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expectRecap();
    expect(readsOf(calls, SUMMARY_URL)).toBe(2);
  });
});
