import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestFinish, type RoundSummary } from "@instant-composition/web";

import {
  fakeApi,
  fakeTimers,
  ja,
  press,
  refusal,
  renderApp,
  settle,
  type ApiCall,
} from "./web-harness";
import { makeSummary } from "./web-summary-fixture";

// The recap screen, W9r, mounted as the whole app at `/recap` over a stand-in
// API: it reads back the summary of the round this client finished last, with
// every value final, and hands over to the start screen when there is none.

const SUMMARY_URL = "/api/v1/rounds/r7/summary";

/** An API that finishes round `r7` and answers its kept summary with `summary`. */
function serveRecap(
  summary: (call: ApiCall) => Response | Promise<Response> = () =>
    Response.json(makeSummary({ roundId: "r7" })),
): ApiCall[] {
  return fakeApi((call) => {
    if (call.method === "POST" && call.url === "/api/v1/rounds/r7/finish") {
      return Response.json(makeSummary({ roundId: "r7" }));
    }
    if (call.method === "GET" && call.url === SUMMARY_URL) return summary(call);
    return undefined;
  });
}

async function finishRound(): Promise<void> {
  const finished = await requestFinish("r7", []);
  expect(finished.ok).toBe(true);
}

function where(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function summaryReads(calls: readonly ApiCall[]): number {
  return calls.filter((call) => call.url === SUMMARY_URL).length;
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
  it("reads back the round finished last, every value final, with no buttons below", async () => {
    const calls = serveRecap();
    await finishRound();
    await renderApp("/recap");
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Summary.title.recap }),
    ).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(summaryReads(calls)).toBe(1);
    expect(
      screen.queryByRole("button", { name: ja.Summary.actions.end }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /もう/u })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ja.Summary.close }),
    ).not.toBeInTheDocument();
  });

  it("goes back on ←", async () => {
    serveRecap();
    await finishRound();
    await renderApp("/recap");
    const back = screen.getByRole("link", { name: ja.Summary.back });
    expect(back).toHaveAttribute("href", "/");
    fireEvent.click(back);
    await settle();
    expect(where()).toBe("/");
  });

  it("goes back on Esc", async () => {
    serveRecap();
    await finishRound();
    await renderApp("/recap");
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });
});

describe("the recap screen with nothing to read back", () => {
  it("goes to the start screen when no round was finished here", async () => {
    const calls = serveRecap();
    await renderApp("/recap");
    expect(where()).toBe("/");
    expect(summaryReads(calls)).toBe(0);
  });

  it("remembers no round whose finish was refused", async () => {
    const calls = fakeApi(() => refusal(409, "ERR_CONFLICT"));
    const finished = await requestFinish("r7", []);
    expect(finished.ok).toBe(false);
    await renderApp("/recap");
    expect(where()).toBe("/");
    expect(summaryReads(calls)).toBe(0);
  });

  it.each([
    [404, "ERR_ROUND_NOT_FOUND"],
    [400, "ERR_BAD_REQUEST"],
  ] as const)(
    "goes to the start screen when the API answers %i %s",
    async (status, code) => {
      serveRecap(() => refusal(status, code));
      await finishRound();
      await renderApp("/recap");
      expect(where()).toBe("/");
    },
  );

  it("goes to the start screen when storage cannot be read or written", async () => {
    const throwing = (): never => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", {
      getItem: throwing,
      setItem: throwing,
      clear: () => undefined,
    });
    const calls = serveRecap();
    await finishRound();
    await renderApp("/recap");
    expect(where()).toBe("/");
    expect(summaryReads(calls)).toBe(0);
  });
});

describe("the recap screen when the read fails", () => {
  it("says so, and reads the summary again on request", async () => {
    let attempts = 0;
    const calls = serveRecap(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : Response.json(makeSummary({ roundId: "r7" }) satisfies RoundSummary);
    });
    await finishRound();
    await renderApp("/recap");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Summary.title.recap }),
    ).toBeInTheDocument();
    expect(summaryReads(calls)).toBe(2);
  });
});
