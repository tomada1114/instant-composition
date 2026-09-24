import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  HomeView,
  SettingsPageView,
  SettingsView,
  TopicInfo,
} from "@instant-composition/web";

import {
  COUNT,
  fakeApi,
  fakeTimers,
  homeView,
  ja,
  refusal,
  renderApp,
  settle,
  type ApiCall,
} from "./web-harness";

// The welcome screen, W1, mounted as the whole app at `/welcome` over a
// stand-in API: a first visit picks its topics from the settings read, saves
// them, and goes on to the placement round; any later visit is the start
// screen's.

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
    settings: { topics: [], focus: [], dailySize: 10, sound: true },
    topics,
    toeic: null,
  };
}

const SAVED: SettingsView = {
  settings: { topics: ["work"], focus: [], dailySize: 10, sound: true },
  removedFocus: [],
  completedToday: false,
};

/**
 * An API for a learner who has chosen no topics yet: the home view is
 * onboarding until a patch is saved, and placement after it.
 */
function serveWelcome(
  options: {
    readonly topics?: TopicInfo[];
    readonly home?: HomeView;
    readonly save?: () => Response | Promise<Response>;
  } = {},
): ApiCall[] {
  let saved = false;
  return fakeApi((call) => {
    if (call.method === "GET" && call.url === "/api/v1/home") {
      return Response.json(
        options.home ?? homeView({ kind: saved ? "placement" : "onboarding" }),
      );
    }
    if (call.method === "GET" && call.url === "/api/v1/settings") {
      return Response.json(settingsPage(options.topics));
    }
    if (call.method === "PATCH" && call.url === "/api/v1/settings") {
      saved = true;
      return options.save?.() ?? Response.json(SAVED);
    }
    return undefined;
  });
}

function where(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function next(): HTMLElement {
  return screen.getByRole("button", { name: ja.Welcome.next });
}

beforeEach(() => {
  fakeTimers();
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
    await settle();
    expect(where()).toBe("/drill?kind=placement");
    const saves = calls.filter((call) => call.method === "PATCH");
    expect(saves.map((call) => call.body)).toStrictEqual([
      { topics: ["work", "daily"] },
    ]);
    // The drill reads the home view afresh, so it sees the placement it now is.
    const afterSave = calls.slice(
      calls.findIndex((call) => call.method === "PATCH") + 1,
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
    await settle();
    await settle();
    expect(where()).toBe("/drill?kind=placement");
  });

  it("stays and says so when the choice cannot be saved", async () => {
    serveWelcome({ save: () => Promise.reject(new TypeError("fetch failed")) });
    await renderApp("/welcome");
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(next());
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Welcome.saveFailed);
    expect(where()).toBe("/welcome");
    expect(next()).toBeEnabled();
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
