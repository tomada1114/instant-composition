import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TUNING, type HomeView } from "@instant-composition/web";

import {
  COUNT,
  PREVIEW,
  fakeApi,
  fakeTimers,
  fill,
  homeView,
  ja,
  press,
  refusal,
  renderApp,
  settle,
  type ApiCall,
  withoutPreview,
} from "./web-harness";

// The web client's home screen, mounted as the whole app at `/` over a
// stand-in API: each W3 state the home view can be in, where each action
// navigates, and what happens before and instead of an answer.

/** An API that answers `view` for the home view and takes a settings patch. */
function serveHome(view: HomeView): ApiCall[] {
  return fakeApi((call) => {
    if (call.method === "GET" && call.url === "/api/v1/home")
      return Response.json(view);
    if (call.method === "PATCH" && call.url === "/api/v1/settings") {
      return Response.json({ settings: {}, removedFocus: [], completedToday: false });
    }
    return undefined;
  });
}

function where(): string {
  return `${window.location.pathname}${window.location.search}`;
}

beforeEach(() => {
  fakeTimers();
});

afterEach(() => {
  act(() => {
    window.history.replaceState(null, "", "/");
  });
});

describe("the home screen, W3a: today's portion not started", () => {
  it("shows the streak, the week, the size and the mix, and starts on the button", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/");
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(ja.Home.streakUnit)).toBeInTheDocument();
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const) {
      expect(screen.getByText(ja.Home.week[day])).toBeInTheDocument();
    }
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.today.minutes, { minutes: 5 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.today.review, { count: 4 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.today.fresh, { count: 6 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.today.focus, { names: "meetings-ja" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.today.start }));
    await settle();
    expect(where()).toBe("/drill?kind=today");
  });

  it("leaves the focus out of the mix when none is chosen, and a new-only mix unsplit", async () => {
    serveHome(
      homeView(
        { kind: "ready", streak: COUNT },
        { preview: { ...PREVIEW, focusNames: [], reviewCount: 0 } },
      ),
    );
    await renderApp("/");
    expect(
      screen.getByText(fill(ja.Home.today.review, { count: 0 })),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(fill(ja.Home.today.focus, { names: "" }), { exact: false }),
    ).toBeNull();
  });

  it("says why the portion is smaller than the setting on a short day", async () => {
    serveHome(
      homeView(
        { kind: "ready", streak: COUNT },
        { preview: { ...PREVIEW, size: 7, shortage: true, minutes: 4, newCount: 0 } },
      ),
    );
    await renderApp("/");
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.today.shortage, { count: 7 })),
    ).toBeInTheDocument();
  });

  it("starts on Space, the screen's primary action", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/");
    press(" ");
    await settle();
    expect(where()).toBe("/drill?kind=today");
  });

  it("leaves Space to a focused control, and ignores held or modified keys", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/");
    const link = screen.getByRole("link", { name: ja.Home.records });
    fireEvent.keyDown(link, { key: " " });
    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.keyDown(window, { key: "a" });
    await settle();
    expect(where()).toBe("/");
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    expect(where()).toBe("/drill?kind=today");
  });

  it("links to the records and the settings", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/");
    expect(screen.getByRole("link", { name: ja.Home.records })).toHaveAttribute(
      "href",
      "/records",
    );
    const settings = screen.getByRole("link", { name: ja.Home.settings });
    expect(settings).toHaveAttribute("href", "/settings");
    fireEvent.click(settings);
    await settle();
    expect(where()).toBe("/settings");
    expect(screen.queryByRole("heading", { name: ja.NotFound.title })).toBeNull();
  });

  it("names the document from the catalog", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    document.head.innerHTML = '<meta name="description" content="" />';
    await renderApp("/");
    expect(document.title).toBe(ja.Metadata.title);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      "content",
      ja.Metadata.description,
    );
  });
});

describe("the home screen, W3b: a portion under way", () => {
  it.each([
    ["today", ja.Home.progress.today],
    ["yesterday", ja.Home.progress.yesterday],
  ] as const)("resumes %s's portion where it stopped", async (portion, title) => {
    serveHome(
      homeView({
        kind: "in-progress",
        portion,
        progress: 4,
        target: 10,
        resumeKind: portion,
        streak: COUNT,
      }),
    );
    await renderApp("/");
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.progress.count, { done: 4, target: 10 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.progress.resume }));
    await settle();
    expect(where()).toBe(`/drill?kind=${portion}`);
  });

  it("draws no progress for a portion with no target", async () => {
    serveHome(
      homeView({
        kind: "in-progress",
        portion: "today",
        progress: 0,
        target: 0,
        resumeKind: "today",
        streak: COUNT,
      }),
    );
    await renderApp("/");
    expect(
      screen.getByText(fill(ja.Home.progress.count, { done: 0, target: 0 })),
    ).toBeInTheDocument();
  });
});

describe("the home screen, W3c: today's portion done", () => {
  it("counts today's rounds and offers one more round of the daily size", async () => {
    serveHome(
      homeView(
        { kind: "done", restoresTo: null, streak: { ...COUNT, value: 13 } },
        { todayLastRoundId: "r7" },
      ),
    );
    await renderApp("/");
    expect(
      screen.getByRole("heading", { name: ja.Home.done.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.done.count, { rounds: 2, cards: 20 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ja.Home.done.recap })).toHaveAttribute(
      "href",
      "/recap",
    );
    press(" ");
    await settle();
    expect(where()).toBe("/drill?kind=extra");
  });

  it("offers no recap link when no round finished today to recap", async () => {
    serveHome(
      homeView({ kind: "done", restoresTo: null, streak: { ...COUNT, value: 13 } }),
    );
    await renderApp("/");
    expect(
      screen.getByRole("heading", { name: ja.Home.done.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: ja.Home.done.recap }),
    ).not.toBeInTheDocument();
  });

  it("makes making up yesterday the primary action until the cut-off", async () => {
    serveHome(
      homeView({ kind: "done", restoresTo: 14, streak: { ...COUNT, value: 1 } }),
    );
    await renderApp("/");
    expect(
      screen.getByText(fill(ja.Home.done.restores, { days: 14 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.deadline, { hour: TUNING.dayBoundaryHour })),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: fill(ja.Home.done.more, { count: 10 }) }),
    );
    await settle();
    expect(where()).toBe("/drill?kind=extra");
  });

  it("goes to yesterday's portion on Space when it can be made up", async () => {
    serveHome(homeView({ kind: "done", restoresTo: 14, streak: COUNT }));
    await renderApp("/");
    press(" ");
    await settle();
    expect(where()).toBe("/drill?kind=yesterday");
  });
});

describe("the home screen, W3d: too few cards", () => {
  it("says how many cards there are and points at the settings, with no start", async () => {
    serveHome(
      withoutPreview(
        homeView({
          kind: "not-enough",
          available: 3,
          streak: COUNT,
        }),
      ),
    );
    await renderApp("/");
    expect(
      screen.getByRole("heading", { name: ja.Home.notEnough.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.notEnough.body, { count: 3 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ja.Home.notEnough.widen })).toHaveAttribute(
      "href",
      "/settings",
    );
    press(" ");
    await settle();
    expect(where()).toBe("/");
  });
});

describe("the home screen, W3e: yesterday open", () => {
  it("offers yesterday and today together, or a fresh start", async () => {
    serveHome(
      homeView(
        {
          kind: "recover-offer",
          streak: { kind: "count", value: 12, yesterdayGap: true },
        },
        { preview: { ...PREVIEW, minutes: 10 } },
      ),
    );
    await renderApp("/");
    expect(screen.getByText(ja.Home.yesterdayGap)).toBeInTheDocument();
    expect(screen.getAllByText(ja.Home.week.gap).length).toBeGreaterThan(0);
    expect(screen.getByText(ja.Home.recover.hint)).toBeInTheDocument();
    expect(
      screen.getByText(
        fill(ja.Home.recover.size, { yesterday: 10, today: 10, minutes: 10 }),
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.recover.restart }));
    await settle();
    expect(where()).toBe("/drill?kind=today");
  });

  it("makes up yesterday on Space, and counts nothing when there is no preview", async () => {
    serveHome(
      withoutPreview(
        homeView({
          kind: "recover-offer",
          streak: COUNT,
        }),
      ),
    );
    await renderApp("/");
    expect(
      screen.getByText(
        fill(ja.Home.recover.size, { yesterday: 0, today: 0, minutes: 0 }),
      ),
    ).toBeInTheDocument();
    press(" ");
    await settle();
    expect(where()).toBe("/drill?kind=yesterday");
  });
});

describe("the home screen, W3f: after a break", () => {
  it("counts from today and names the longest run, never a 0", async () => {
    serveHome(homeView({ kind: "ready", streak: { kind: "restart", longest: 21 } }));
    await renderApp("/");
    expect(
      screen.getByRole("heading", { name: ja.Home.restartTitle }),
    ).toBeInTheDocument();
    expect(screen.getByText(fill(ja.Home.longest, { days: 21 }))).toBeInTheDocument();
    expect(screen.queryByText(ja.Home.streakUnit)).not.toBeInTheDocument();
  });
});

describe("the home screen before and instead of the home view", () => {
  it("shows nothing for 300 ms, then the skeleton, until the view answers", async () => {
    let answer: (response: Response) => void = () => undefined;
    fakeApi(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    await renderApp("/");
    const main = document.querySelector("main");
    expect(main).toHaveAttribute("aria-hidden", "true");
    expect(main?.childElementCount).toBe(0);
    await settle(TUNING.skeletonDelayMs);
    expect(main?.childElementCount).toBe(3);
    answer(Response.json(homeView({ kind: "ready", streak: COUNT })));
    await settle();
    expect(
      screen.getByRole("button", { name: ja.Home.today.start }),
    ).toBeInTheDocument();
  });

  it("goes on to picking topics on a first visit", async () => {
    serveHome(homeView({ kind: "onboarding" }));
    await renderApp("/");
    await settle();
    expect(where()).toBe("/welcome");
  });

  it("goes on to the placement round before it is done", async () => {
    const calls = serveHome(homeView({ kind: "placement" }));
    await renderApp("/");
    await settle();
    expect(where()).toBe("/drill?kind=placement");
    expect(calls.some((call) => call.url === "/api/v1/rounds")).toBe(true);
  });

  it("says the view could not be read, and reads it again on request", async () => {
    let attempts = 0;
    fakeApi(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : Response.json(homeView({ kind: "ready", streak: COUNT }));
    });
    await renderApp("/");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(
      screen.getByRole("button", { name: ja.Home.today.start }),
    ).toBeInTheDocument();
  });

  it("says the cards could not be read, and reads the view again on request", async () => {
    const calls = serveHome(
      withoutPreview(
        homeView(
          { kind: "not-enough", available: 0, streak: COUNT },
          { contentError: true },
        ),
      ),
    );
    await renderApp("/");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(calls.filter((call) => call.url === "/api/v1/home")).toHaveLength(2);
  });

  it("renders the not-found page for a path it has no screen for", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/nonsense");
    expect(
      screen.getByRole("heading", { name: ja.NotFound.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: ja.NotFound.homeLink }));
    await settle();
    await settle(16);
    expect(
      screen.getByRole("button", { name: ja.Home.today.start }),
    ).toBeInTheDocument();
  });
});

describe("the sound switch", () => {
  it("says its state, and saves the change", async () => {
    const calls = serveHome(
      homeView({ kind: "ready", streak: COUNT }, { sound: true }),
    );
    await renderApp("/");
    const toggle = screen.getByRole("button", { name: ja.Home.soundOn });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    await settle();
    expect(calls.filter((call) => call.method === "PATCH")).toStrictEqual([
      { method: "PATCH", url: "/api/v1/settings", body: { sound: false } },
    ]);
    expect(screen.getByRole("button", { name: ja.Home.soundOff })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("goes back when the change cannot be saved", async () => {
    fakeApi((call) =>
      call.method === "GET"
        ? Response.json(homeView({ kind: "ready", streak: COUNT }, { sound: true }))
        : refusal(503, "ERR_CONTENT_UNREADABLE"),
    );
    await renderApp("/");
    fireEvent.click(screen.getByRole("button", { name: ja.Home.soundOn }));
    await settle();
    expect(screen.getByRole("button", { name: ja.Home.soundOn })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("settles on what the last save left, however the answers arrive", async () => {
    const pending: ((ok: boolean) => void)[] = [];
    fakeApi((call) =>
      call.method === "GET"
        ? Response.json(homeView({ kind: "ready", streak: COUNT }, { sound: true }))
        : new Promise<Response>((resolve) => {
            pending.push((ok) => {
              resolve(
                ok
                  ? Response.json({
                      settings: {},
                      removedFocus: [],
                      completedToday: false,
                    })
                  : refusal(409, "ERR_CONFLICT"),
              );
            });
          }),
    );
    await renderApp("/");
    fireEvent.click(screen.getByRole("button", { name: ja.Home.soundOn }));
    fireEvent.click(screen.getByRole("button", { name: ja.Home.soundOff }));
    fireEvent.click(screen.getByRole("button", { name: ja.Home.soundOn }));
    pending[2]?.(true);
    await settle();
    pending[0]?.(false);
    await settle();
    expect(screen.getByRole("button", { name: ja.Home.soundOff })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
