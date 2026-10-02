import { act, cleanup, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

import {
  App,
  MESSAGES,
  type Dot,
  type DrillCard,
  type HomePreview,
  type HomeState,
  type HomeView,
  type RoundPayload,
  type StreakView,
} from "@instant-composition/web";

// What the web client's rendered suites share: the whole app mounted at a
// path, a stand-in for the API behind `fetch`, and the fixtures its answers
// are built from. Nothing here asserts.

export const ja = MESSAGES;

/** One request the app made, as the API would read it. */
export interface ApiCall {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/**
 * Answers every `fetch` the app makes with `respond`, and records each call.
 * A handler that returns `undefined` stands for a route the stand-in does not
 * serve, answered like the API's bare unmatched `404`.
 */
export function fakeApi(
  respond: (call: ApiCall) => Promise<Response> | Response | undefined,
): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const call: ApiCall = {
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null,
    };
    calls.push(call);
    return (await respond(call)) ?? new Response(null, { status: 404 });
  });
  return calls;
}

/** The API's error envelope for `code`. */
export function refusal(status: number, code: string): Response {
  return Response.json({ error: { code, message: "A fixed sentence." } }, { status });
}

/** Fills a catalog template's `{name}` arguments. */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)[^}]*\}/gu, (_, name: string) =>
    String(values[name]),
  );
}

/** Timers the rendered suites fake: every clock the drill and the app read. */
export function fakeTimers(): void {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
}

/** Lets `ms` pass, and every promise and render it releases settle. */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Presses `key` on the window; `code` is the physical key, which a chosen grade key is read by. */
export function press(key: string, code = ""): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, code, cancelable: true }));
  });
}

/**
 * Every navigation landmark on the screen, each as its links' targets and
 * `aria-current` values, in order.
 */
export function navigations(): (readonly [string | null, string | null])[][] {
  return screen.queryAllByRole("navigation").map((nav) =>
    within(nav)
      .getAllByRole("link")
      .map(
        (link) =>
          [link.getAttribute("href"), link.getAttribute("aria-current")] as const,
      ),
  );
}

/** The page's `navigation` and `main` landmarks, by role, in document order. */
export function landmarks(): string[] {
  return [...document.querySelectorAll("nav, main")].map((element) =>
    element.localName === "nav" ? "navigation" : "main",
  );
}

/** Mounts the whole app at `path`, and lets its first reads answer. */
export async function renderApp(path: string): Promise<void> {
  // The router restores the scroll position on every navigation, and jsdom
  // implements no scrolling; the stand-in keeps that out of the output.
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.history.replaceState(null, "", path);
  render(<App />);
  await settle();
  await settle(16);
}

/**
 * Mounts the app once and asks it for a role, then leaves no trace. The first
 * render and the first role query in a worker are an order of magnitude
 * slower than every later one — code compiled and caches filled once — and
 * that one-time cost, billed to whichever test ran first, is what pushed it
 * past its budget on a loaded machine. Call it from a `beforeAll`, so the cost
 * lands on the hook and every test is timed on its own work alone.
 */
export async function warmUp(): Promise<void> {
  fakeTimers();
  fakeApi(() => undefined);
  try {
    await renderApp("/");
    screen.queryAllByRole("button", { name: ja.Home.loadFailed.reload });
  } finally {
    cleanup();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
}

export const COUNT: Extract<StreakView, { kind: "count" }> = {
  kind: "count",
  value: 12,
  yesterdayGap: false,
};

export const WEEK: Dot[] = [
  { day: "2026-09-21", state: "done" },
  { day: "2026-09-22", state: "gap" },
  { day: "2026-09-23", state: "upcoming" },
  { day: "2026-09-24", state: "upcoming" },
  { day: "2026-09-25", state: "upcoming" },
  { day: "2026-09-26", state: "upcoming" },
  { day: "2026-09-27", state: "upcoming" },
];

export const PREVIEW: HomePreview = {
  size: 10,
  setting: 10,
  shortage: false,
  reviewCount: 4,
  newCount: 6,
  focusNames: ["meetings-ja"],
  weakNames: ["命令文・Let's", "現在完了"],
  minutes: 5,
};

export function homeView(
  state: HomeState,
  overrides: Partial<HomeView> = {},
): HomeView {
  return {
    state,
    week: WEEK,
    preview: PREVIEW,
    todayRounds: 2,
    todayCards: 20,
    dailySize: 10,
    sound: false,
    gradeKeys: { ok: "ArrowRight", ng: "ArrowLeft" },
    contentError: false,
    ...overrides,
  };
}

/** `view` with no preview, as the API sends it when no round can be dealt today. */
export function withoutPreview(view: HomeView): HomeView {
  const copy = { ...view };
  delete copy.preview;
  return copy;
}

export function drillCard(id: string, overrides: Partial<DrillCard> = {}): DrillCard {
  return {
    id,
    topic: "work",
    subtopic: "meetings",
    level: 3,
    words: 6,
    prompt: `prompt-${id}`,
    text: `answer-${id}`,
    alternatives: [],
    explanation: `point-${id}`,
    limitMs: 7000,
    paceMs: 7000,
    ...overrides,
  };
}

export const ROUND: RoundPayload = {
  id: "round-1",
  kind: "today",
  day: "2026-09-22",
  portionDay: "2026-09-22",
  deck: ["c1", "c2"],
  cards: { c1: drillCard("c1"), c2: drillCard("c2") },
  answered: [],
  offset: 0,
  total: 2,
  retries: true,
};
