import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HomeView,
  LevelView,
  Profile,
  SettingsPageView,
  SettingsView,
  TopicInfo,
} from "@instant-composition/web";

import {
  COUNT,
  fakeApi,
  fakeTimers,
  fill,
  homeView,
  ja,
  refusal,
  renderApp,
  settle,
  type ApiCall,
} from "./web-harness";

// The welcome screen, W1, mounted as the whole app at `/welcome` over a
// stand-in API: a first visit picks its topics from the settings read, sends
// the browser's time zone and saves the topics, and goes on to the placement
// round or, with a level picked by hand, to the start screen; any later visit
// is the start screen's.

const TOPICS: TopicInfo[] = [
  {
    id: "work",
    name: "仕事",
    subtopics: [
      { id: "meetings", name: "会議" },
      { id: "requests", name: "依頼" },
    ],
  },
  { id: "daily", name: "日常", subtopics: [{ id: "home", name: "家" }] },
];

function settingsPage(topics: TopicInfo[] = TOPICS): SettingsPageView {
  return {
    settings: { topics: [], focus: [], dailySize: 10, sound: true, limitSeconds: 30 },
    topics,
    toeic: null,
    difficulty: { mode: "auto", level: null, toeic: null },
    levels: ["300", "400", "500", "600", "730", "800", "860", "900", "950", "990+"].map(
      (toeic, index) => ({ level: index + 1, toeic }),
    ),
  };
}

const CHOSEN: LevelView = { mode: "manual", level: 5, toeic: "730" };

const SAVED: SettingsView = {
  settings: {
    topics: ["work"],
    focus: [],
    dailySize: 10,
    sound: true,
    limitSeconds: 30,
  },
  removedFocus: [],
  completedToday: false,
};

/** The time zone the tests' browser reports, whatever the process runs in. */
const BROWSER_ZONE = "Europe/London";

const PROFILE: Profile = {
  timeZone: BROWSER_ZONE,
  l1: "ja",
  target: "en",
  uiLocale: "ja",
};

/**
 * An API for a learner who has chosen no topics yet: the home view is
 * onboarding until a patch is saved, and after it placement, or ready once a
 * level was picked.
 */
function serveWelcome(
  options: {
    readonly topics?: TopicInfo[];
    readonly home?: HomeView;
    readonly save?: () => Response | Promise<Response>;
    readonly profile?: () => Response | Promise<Response>;
    readonly level?: () => Response | Promise<Response>;
  } = {},
): ApiCall[] {
  let saved = false;
  let leveled = false;
  return fakeApi((call) => {
    if (call.method === "GET" && call.url === "/api/v1/home") {
      if (options.home !== undefined) return Response.json(options.home);
      if (!saved) return Response.json(homeView({ kind: "onboarding" }));
      return Response.json(
        leveled
          ? homeView({ kind: "ready", streak: COUNT })
          : homeView({ kind: "placement" }),
      );
    }
    if (call.method === "GET" && call.url === "/api/v1/settings") {
      return Response.json(settingsPage(options.topics));
    }
    if (call.method === "PATCH" && call.url === "/api/v1/settings") {
      saved = true;
      return options.save?.() ?? Response.json(SAVED);
    }
    if (call.method === "PATCH" && call.url === "/api/v1/me") {
      return options.profile?.() ?? Response.json(PROFILE);
    }
    if (call.method === "PATCH" && call.url === "/api/v1/level") {
      if (options.level !== undefined) return options.level();
      leveled = true;
      return Response.json(CHOSEN);
    }
    return undefined;
  });
}

function patches(calls: readonly ApiCall[]): [string, unknown][] {
  return calls
    .filter((call) => call.method === "PATCH")
    .map((call) => [call.url, call.body]);
}

function where(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function next(): HTMLElement {
  return screen.getByRole("button", { name: ja.Welcome.next });
}

function measure(): HTMLElement {
  return screen.getByRole("button", { name: ja.Welcome.start.measure });
}

function start(): HTMLElement {
  return screen.getByRole("button", { name: ja.Welcome.level.start });
}

function level(toeic: string): HTMLElement {
  return screen.getByRole("radio", {
    name: fill(ja.Settings.difficulty.option, { toeic }),
  });
}

beforeEach(() => {
  fakeTimers();
  // Only the zone is replaced; everything else is what this runtime resolves.
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...resolved,
    timeZone: BROWSER_ZONE,
  });
});

afterEach(() => {
  act(() => {
    window.history.replaceState(null, "", "/");
  });
});

describe("the welcome screen, W1", () => {
  it("lists every topic with its subtopics, none chosen, and holds the next step back", async () => {
    serveWelcome();
    await renderApp("/welcome");
    expect(screen.getByRole("heading", { name: ja.Welcome.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /仕事/u })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("会議・依頼")).toBeInTheDocument();
    expect(next()).toBeDisabled();
  });

  it("saves the chosen topics in the taxonomy's order and goes on to the placement", async () => {
    const calls = serveWelcome();
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(screen.getByRole("button", { name: /仕事/u }));
    expect(screen.getByRole("button", { name: /仕事/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(next()).toBeEnabled();
    fireEvent.click(next());
    await settle();
    expect(patches(calls)).toStrictEqual([]);
    fireEvent.click(measure());
    await settle();
    await settle();
    expect(where()).toBe("/drill?kind=placement");
    expect(patches(calls)).toStrictEqual([
      ["/api/v1/me", { timeZone: BROWSER_ZONE }],
      ["/api/v1/settings", { topics: ["work", "daily"] }],
    ]);
    // The drill reads the home view afresh, so it sees the placement it now is.
    const afterSave = calls.slice(
      calls.findIndex(
        (call) => call.url === "/api/v1/settings" && call.method === "PATCH",
      ) + 1,
    );
    expect(afterSave.map((call) => call.url)).toContain("/api/v1/home");
  });

  it("drops a topic chosen twice, back to holding the next step", async () => {
    serveWelcome();
    await renderApp("/welcome");
    const work = screen.getByRole("button", { name: /仕事/u });
    fireEvent.click(work);
    fireEvent.click(work);
    expect(work).toHaveAttribute("aria-pressed", "false");
    expect(next()).toBeDisabled();
  });

  it("goes on with Enter once a topic is chosen", async () => {
    serveWelcome();
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(
      screen.getByRole("heading", { name: ja.Welcome.start.title }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    await settle();
    expect(where()).toBe("/drill?kind=placement");
  });

  it("stays and says so when the choice cannot be saved", async () => {
    serveWelcome({ save: () => Promise.reject(new TypeError("fetch failed")) });
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(next());
    fireEvent.click(measure());
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Welcome.saveFailed);
    expect(where()).toBe("/welcome");
    expect(measure()).toBeEnabled();
  });

  it("goes on with the profile's own time zone when the API does not know the browser's", async () => {
    const calls = serveWelcome({ profile: () => refusal(400, "ERR_BAD_REQUEST") });
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(next());
    fireEvent.click(measure());
    await settle();
    await settle();
    expect(where()).toBe("/drill?kind=placement");
    expect(patches(calls).map(([url]) => url)).toStrictEqual([
      "/api/v1/me",
      "/api/v1/settings",
    ]);
  });

  it("stays and saves no topics when the time zone cannot be sent", async () => {
    const calls = serveWelcome({
      profile: () => Promise.reject(new TypeError("fetch failed")),
    });
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(next());
    fireEvent.click(measure());
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Welcome.saveFailed);
    expect(where()).toBe("/welcome");
    expect(patches(calls).map(([url]) => url)).toStrictEqual(["/api/v1/me"]);
  });

  it("sends the time zone once, even when the topics take a second try", async () => {
    let attempts = 0;
    const calls = serveWelcome({
      save: () => {
        attempts += 1;
        return attempts === 1 ? refusal(409, "ERR_CONFLICT") : Response.json(SAVED);
      },
    });
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(next());
    fireEvent.click(measure());
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Welcome.saveFailed);
    fireEvent.click(measure());
    await settle();
    await settle();
    expect(where()).toBe("/drill?kind=placement");
    expect(patches(calls).map(([url]) => url)).toStrictEqual([
      "/api/v1/me",
      "/api/v1/settings",
      "/api/v1/settings",
    ]);
  });

  it("says the cards could not be read, rather than offer nothing to choose", async () => {
    const calls = serveWelcome({ topics: [] });
    await renderApp("/welcome");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ja.Welcome.next }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(calls.filter((call) => call.url === "/api/v1/settings")).toHaveLength(2);
  });
});

describe("the welcome screen, W1 picking a level", () => {
  it("saves a level picked by hand before the topics and goes to the start screen, not the placement", async () => {
    const calls = serveWelcome();
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /仕事/u }));
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: ja.Welcome.start.choose }));
    expect(
      screen.getByRole("heading", { name: ja.Welcome.level.title }),
    ).toBeInTheDocument();
    expect(start()).toBeDisabled();
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    fireEvent.click(level("730"));
    expect(level("730")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(start());
    await settle();
    await settle();
    expect(patches(calls)).toStrictEqual([
      ["/api/v1/me", { timeZone: BROWSER_ZONE }],
      ["/api/v1/level", { mode: "manual", level: 5 }],
      ["/api/v1/settings", { topics: ["work"] }],
    ]);
    expect(where()).toBe("/");
  });

  it("stays and saves no topics when the level cannot be saved", async () => {
    const calls = serveWelcome({ level: () => refusal(409, "ERR_CONFLICT") });
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /仕事/u }));
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: ja.Welcome.start.choose }));
    fireEvent.click(level("990+"));
    fireEvent.click(start());
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Welcome.saveFailed);
    expect(where()).toBe("/welcome");
    expect(patches(calls).map(([url]) => url)).toStrictEqual([
      "/api/v1/me",
      "/api/v1/level",
    ]);
    expect(start()).toBeEnabled();
  });

  it("goes back a step at a time, keeping the topics chosen", async () => {
    const calls = serveWelcome();
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: ja.Welcome.start.choose }));
    fireEvent.click(screen.getByRole("button", { name: ja.Welcome.back }));
    expect(
      screen.getByRole("heading", { name: ja.Welcome.start.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Welcome.back }));
    expect(screen.getByRole("button", { name: /日常/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(patches(calls)).toStrictEqual([]);
  });
});

describe("the welcome screen after the first visit", () => {
  it("goes to the start screen once topics are chosen", async () => {
    serveWelcome({ home: homeView({ kind: "ready", streak: COUNT }) });
    await renderApp("/welcome");
    await settle();
    expect(where()).toBe("/");
  });
});

describe("the welcome screen when a read fails", () => {
  it("says so, and reads both again on request", async () => {
    let refused = true;
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home") {
        return refused
          ? refusal(403, "ERR_FORBIDDEN")
          : Response.json(homeView({ kind: "onboarding" }));
      }
      return Response.json(settingsPage());
    });
    await renderApp("/welcome");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    refused = false;
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(screen.getByRole("heading", { name: ja.Welcome.title })).toBeInTheDocument();
    expect(calls.map((call) => call.url).sort()).toStrictEqual([
      "/api/v1/home",
      "/api/v1/home",
      "/api/v1/settings",
      "/api/v1/settings",
    ]);
  });
});
