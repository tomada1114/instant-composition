import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TUNING, type HomeView, type RecordsView } from "@instant-composition/web";

import {
  COUNT,
  PREVIEW,
  ROUND,
  fakeApi,
  fakeTimers,
  fill,
  homeView,
  ja,
  landmarks,
  navigations,
  press,
  refusal,
  renderApp,
  settle,
  type ApiCall,
  warmUp,
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

/** Records every URL the app hands `location.assign`, leaving the browser where it is. */
function stubAssign(): string[] {
  const visited: string[] = [];
  const real = window.location;
  const assign = (url: string): void => {
    visited.push(url);
  };
  vi.stubGlobal(
    "location",
    // A proxy over the real Location would break the invariant its
    // non-configurable `assign` imposes, so it wraps an empty target.
    new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === "assign") return assign;
          const value: unknown = Reflect.get(real, key);
          const read: unknown = typeof value === "function" ? value.bind(real) : value;
          return read;
        },
      },
    ),
  );
  return visited;
}

beforeAll(warmUp);

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
    expect(
      screen.getByText(fill(ja.Home.today.weak, { names: "命令文・Let's、現在完了" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.today.start }));
    await settle();
    expect(where()).toBe("/drill?kind=today");
  });

  it("leaves the focus and the weak grammar out of the mix when there are none, and a new-only mix unsplit", async () => {
    serveHome(
      homeView(
        { kind: "ready", streak: COUNT },
        { preview: { ...PREVIEW, focusNames: [], weakNames: [], reviewCount: 0 } },
      ),
    );
    await renderApp("/");
    expect(
      screen.getByText(fill(ja.Home.today.review, { count: 0 })),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(fill(ja.Home.today.focus, { names: "" }), { exact: false }),
    ).toBeNull();
    expect(
      screen.queryByText(fill(ja.Home.today.weak, { names: "" }), { exact: false }),
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
    const link = screen.getByRole("link", { name: ja.Nav.records });
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

  it("carries the one navigation, home current, and follows it to the settings", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/");
    expect(navigations()).toStrictEqual([
      [
        ["/", "page"],
        ["/talk", null],
        ["/records", null],
        ["/settings", null],
      ],
    ]);
    expect(screen.getByRole("navigation", { name: ja.Nav.label })).toBeInTheDocument();
    expect(landmarks()).toStrictEqual(["navigation", "main"]);
    const settings = screen.getByRole("link", { name: ja.Nav.settings });
    fireEvent.click(settings);
    await settle();
    expect(where()).toBe("/settings");
    expect(screen.queryByRole("heading", { name: ja.NotFound.title })).toBeNull();
  });

  it("follows the talk tab to /talk, which marks it current and is no missing page", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/");
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.talk }));
    await settle();
    expect(where()).toBe("/talk");
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/talk", "page"],
        ["/records", null],
        ["/settings", null],
      ],
    ]);
    expect(screen.queryByRole("heading", { name: ja.NotFound.title })).toBeNull();
  });

  it("marks home current when the address carries a query", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/?utm_source=x");
    expect(navigations()).toStrictEqual([
      [
        ["/", "page"],
        ["/talk", null],
        ["/records", null],
        ["/settings", null],
      ],
    ]);
  });

  it("shows no navigation until the view answers, so a visitor never sees it flash", async () => {
    fakeApi(() => new Promise<Response>(() => undefined));
    await renderApp("/");
    await settle(TUNING.skeletonDelayMs);
    expect(navigations()).toStrictEqual([]);
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

/** A records view with `weak` and `topics`, the rest of it empty. */
function recordsView(
  weak: RecordsView["weak"],
  topics: RecordsView["reach"]["topics"],
): RecordsView {
  return {
    reach: { topics, nearest: null },
    breakdown: [],
    weak,
    toeic: null,
    levelMode: "auto",
    suggestedToeic: null,
    streak: { current: 12, longest: 12 },
    calendar: [],
    said: 0,
    practicedDays: 0,
    points: 0,
    titles: [],
  };
}

/** An API that answers `view` for the home view and `records` for the records read. */
function serveHomeAndRecords(
  view: HomeView,
  records: () => Promise<Response> | Response,
): ApiCall[] {
  return fakeApi((call) => {
    if (call.url === "/api/v1/home") return Response.json(view);
    if (call.url === "/api/v1/records") return records();
    return undefined;
  });
}

const RECORDS = recordsView(
  { grammar: [{ id: "perfect", name: "現在完了" }], subtopics: [] },
  [
    {
      id: "work",
      name: "仕事",
      count: 42,
      added: 2,
      ring: { from: 25, to: 50, done: 17, span: 25 },
    },
    {
      id: "travel",
      name: "旅行",
      count: 18,
      added: 0,
      ring: { from: 10, to: 25, done: 8, span: 15 },
    },
  ],
);

function tile(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("the home screen's tiles, read from the records beside the home view", () => {
  it("shows the weak grammar, each topic's mastered count and the talk, each records tile leading to the records page", async () => {
    serveHomeAndRecords(homeView({ kind: "ready", streak: COUNT }), () =>
      Response.json(RECORDS),
    );
    await renderApp("/");
    expect(within(tile(ja.Home.tiles.weak)).getByText("現在完了")).toBeInTheDocument();
    const reach = within(tile(ja.Home.tiles.reach));
    expect(reach.getByText("仕事")).toBeInTheDocument();
    expect(reach.getByText("42")).toBeInTheDocument();
    expect(reach.getByText("旅行")).toBeInTheDocument();
    expect(reach.getByText("18")).toBeInTheDocument();
    for (const name of [ja.Home.tiles.weak, ja.Home.tiles.reach]) {
      expect(
        within(tile(name)).getByRole("link", { name: ja.Home.tiles.seeRecords }),
      ).toHaveAttribute("href", "/records");
    }
    const talk = within(tile(ja.Home.tiles.talk));
    expect(talk.getByText(String(TUNING.talkTurns))).toBeInTheDocument();
    expect(talk.getByText(ja.Talk.start.scene)).toBeInTheDocument();
    expect(talk.getByRole("link", { name: ja.Home.tiles.talkStart })).toHaveAttribute(
      "href",
      "/talk",
    );
  });

  it("says each records tile could not be read when the read fails, and still starts a round", async () => {
    serveHomeAndRecords(homeView({ kind: "ready", streak: COUNT }), () =>
      refusal(503, "ERR_CONTENT_UNREADABLE"),
    );
    await renderApp("/");
    for (const name of [ja.Home.tiles.weak, ja.Home.tiles.reach]) {
      expect(within(tile(name)).getByText(ja.Home.tiles.failed)).toBeInTheDocument();
    }
    expect(
      within(tile(ja.Home.tiles.talk)).queryByText(ja.Home.tiles.failed),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.today.start }));
    await settle();
    expect(where()).toBe("/drill?kind=today");
  });

  it("shows the titles alone until the records read answers", async () => {
    serveHomeAndRecords(
      homeView({ kind: "ready", streak: COUNT }),
      () => new Promise<Response>(() => undefined),
    );
    await renderApp("/");
    for (const name of [ja.Home.tiles.weak, ja.Home.tiles.reach]) {
      const region = tile(name);
      expect(within(region).getByRole("heading", { name })).toBeInTheDocument();
      expect(within(region).queryByText(ja.Home.tiles.failed)).toBeNull();
      expect(within(region).queryAllByRole("listitem")).toHaveLength(0);
      expect(within(region).queryByRole("definition")).toBeNull();
    }
  });

  it("says there is nothing weak and nothing mastered yet on an empty record", async () => {
    serveHomeAndRecords(homeView({ kind: "ready", streak: COUNT }), () =>
      Response.json(recordsView({ grammar: [], subtopics: [] }, [])),
    );
    await renderApp("/");
    expect(
      within(tile(ja.Home.tiles.weak)).getByText(ja.Records.weak.none),
    ).toBeInTheDocument();
    expect(
      within(tile(ja.Home.tiles.reach)).getByText(ja.Summary.reach.empty),
    ).toBeInTheDocument();
  });

  it("shows at most three weak names a kind", async () => {
    serveHomeAndRecords(homeView({ kind: "ready", streak: COUNT }), () =>
      Response.json(
        recordsView(
          {
            grammar: ["a", "b", "c", "d"].map((id) => ({ id, name: `g-${id}` })),
            subtopics: [{ topic: "work", subtopic: "meetings", name: "会議" }],
          },
          [],
        ),
      ),
    );
    await renderApp("/");
    const weak = within(tile(ja.Home.tiles.weak));
    expect(weak.getByText("g-a、g-b、g-c")).toBeInTheDocument();
    expect(weak.getByText("会議")).toBeInTheDocument();
  });
});

describe("the home screen's week row", () => {
  it("marks today undone apart from the days ahead, and says each day's state in words", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 23, 12));
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/");
    const states = [...document.querySelectorAll("ol [data-state]")].map((disc) =>
      disc.getAttribute("data-state"),
    );
    expect(states).toStrictEqual([
      "done",
      "gap",
      "today",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(screen.getByText(ja.Home.week.today)).toHaveClass("sr-only");
    expect(screen.getByText(ja.Home.week.done)).toHaveClass("sr-only");
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
    const skeleton = document.querySelector("main")?.firstElementChild;
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton?.childElementCount).toBe(0);
    await settle(TUNING.skeletonDelayMs);
    expect(skeleton?.childElementCount).toBe(3);
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

  it("opens a placement it forwards to, already under way, on the start screen", async () => {
    fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "placement" }));
      if (call.url === "/api/v1/rounds") {
        return Response.json({
          ...ROUND,
          kind: "placement",
          retries: false,
          answered: [
            {
              id: "round-1:f:c1",
              cardId: "c1",
              pass: "first",
              result: "ok",
              answeredAt: Date.UTC(2026, 8, 22, 3, 0),
            },
          ],
        });
      }
      return undefined;
    });
    await renderApp("/");
    await settle();
    await settle(16);
    expect(where()).toBe("/drill?kind=placement");
    expect(
      screen.getByRole("button", { name: ja.Drill.ready.start }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-part=fill]")).toBeNull();
    press("Enter");
    await settle(16);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();
    expect(document.querySelector("[data-part=fill]")).not.toBeNull();
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
    expect(navigations()).toStrictEqual([
      [
        ["/", "page"],
        ["/talk", null],
        ["/records", null],
        ["/settings", null],
      ],
    ]);
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
    expect(screen.getByText(ja.NotFound.description)).toBeInTheDocument();
    expect(navigations()).toStrictEqual([]);
    fireEvent.click(screen.getByRole("link", { name: ja.NotFound.homeLink }));
    await settle();
    await settle(16);
    expect(
      screen.getByRole("button", { name: ja.Home.today.start }),
    ).toBeInTheDocument();
  });

  it("goes home from the not-found page on Space", async () => {
    serveHome(homeView({ kind: "ready", streak: COUNT }));
    await renderApp("/nonsense");
    press(" ");
    await settle();
    await settle(16);
    expect(where()).toBe("/");
    expect(
      screen.getByRole("button", { name: ja.Home.today.start }),
    ).toBeInTheDocument();
  });
});

describe("a visitor who is not signed in", () => {
  /** An API that refuses every read and every refresh, as it does with no session cookie. */
  function serveSignedOut(): ApiCall[] {
    return fakeApi(() => refusal(401, "ERR_UNAUTHENTICATED"));
  }

  it("sees the landing screen at /, with sign-in as its one action, and is not sent away", async () => {
    const visited = stubAssign();
    const calls = serveSignedOut();
    await renderApp("/");
    await settle(TUNING.skeletonDelayMs);
    expect(screen.getByRole("heading", { name: ja.Landing.title })).toBeInTheDocument();
    for (const step of Object.values(ja.Landing.steps)) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: ja.Landing.signIn })).toHaveAttribute(
      "href",
      "/api/v1/auth/login",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: ja.Home.loadFailed.title }),
    ).not.toBeInTheDocument();
    expect(visited).toStrictEqual([]);
    expect(calls.map((call) => call.url)).toStrictEqual([
      "/api/v1/home",
      "/api/v1/auth/refresh",
    ]);
  });

  it("signs in on Space, whether or not the sign-in link has focus, and leaves Enter on it to the browser", async () => {
    serveSignedOut();
    await renderApp("/");
    const link = screen.getByRole("link", { name: ja.Landing.signIn });
    let presses = 0;
    link.addEventListener("click", (event) => {
      presses += 1;
      event.preventDefault();
    });
    press(" ");
    expect(presses).toBe(1);
    link.focus();
    fireEvent.keyDown(link, { key: " " });
    expect(presses).toBe(2);
    fireEvent.keyDown(link, { key: "Enter" });
    expect(presses).toBe(2);
  });

  it.each(["/records", "/settings", "/welcome", "/recap", "/drill?kind=today"])(
    "is sent from %s to the landing screen at /, not to sign in",
    async (path) => {
      const visited = stubAssign();
      serveSignedOut();
      await renderApp(path);
      await settle();
      await settle(16);
      expect(where()).toBe("/");
      expect(
        screen.getByRole("heading", { name: ja.Landing.title }),
      ).toBeInTheDocument();
      expect(visited).toStrictEqual([]);
    },
  );
});

describe("a session that runs out while the app is open", () => {
  it("sends the browser to sign in, and the next screen stays loading with no failure", async () => {
    const visited = stubAssign();
    const calls = fakeApi((call) =>
      call.url === "/api/v1/home"
        ? Response.json(homeView({ kind: "ready", streak: COUNT }))
        : refusal(401, "ERR_UNAUTHENTICATED"),
    );
    await renderApp("/");
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.records }));
    await settle();
    await settle(TUNING.skeletonDelayMs);
    expect(visited).toStrictEqual(["/api/v1/auth/login"]);
    expect(where()).toBe("/records");
    expect(calls.map((call) => call.url).slice(-2)).toStrictEqual([
      "/api/v1/records",
      "/api/v1/auth/refresh",
    ]);
    // The records page's loading state: its column, and nothing in it.
    const mains = document.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]?.childElementCount).toBe(0);
    expect(
      screen.queryByRole("heading", { name: ja.Home.loadFailed.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: ja.Landing.title }),
    ).not.toBeInTheDocument();
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
      call.url === "/api/v1/home"
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
      call.url === "/api/v1/home"
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
