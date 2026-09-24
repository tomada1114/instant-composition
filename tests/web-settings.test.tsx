import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  Settings,
  SettingsPageView,
  SettingsPatch,
  SettingsView,
} from "@instant-composition/web";

import {
  fakeApi,
  fakeTimers,
  fill,
  ja,
  press,
  renderApp,
  settle,
  type ApiCall,
} from "./web-harness";

// The settings screen, W11 with W12's confirmation over it, mounted as the
// whole app at `/settings` over a stand-in API that keeps what it is sent:
// each change saved as it is made, what a save answers, a failed save, and
// measuring again.

const SETTINGS: Settings = {
  topics: ["daily", "work"],
  focus: [],
  dailySize: 10,
  sound: true,
};

const PAGE: SettingsPageView = {
  settings: SETTINGS,
  topics: [
    { id: "daily", name: "日常", subtopics: [{ id: "home", name: "家" }] },
    {
      id: "work",
      name: "仕事",
      subtopics: [
        { id: "meetings", name: "会議" },
        { id: "email", name: "メール・チャット" },
        { id: "schedule", name: "日程調整" },
      ],
    },
    { id: "travel", name: "旅行", subtopics: [{ id: "airport", name: "空港" }] },
  ],
  toeic: "730",
};

/**
 * An API that answers `page` for the settings read and saves every patch,
 * answering with `reply`'s extras; the patches it was sent are returned.
 */
function serveSettings(
  page: SettingsPageView = PAGE,
  reply: Partial<SettingsView> = {},
): { readonly patches: SettingsPatch[]; readonly calls: ApiCall[] } {
  const patches: SettingsPatch[] = [];
  let settings = page.settings;
  const calls = fakeApi((call) => {
    if (call.method === "GET" && call.url === "/api/v1/settings") {
      return Response.json(page);
    }
    if (call.method === "PATCH" && call.url === "/api/v1/settings") {
      const patch = call.body as SettingsPatch;
      patches.push(patch);
      settings = { ...settings, ...patch };
      return Response.json({
        settings,
        removedFocus: [],
        completedToday: false,
        ...reply,
      } satisfies SettingsView);
    }
    return undefined;
  });
  return { patches, calls };
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

describe("the settings screen, W11 topics", () => {
  it("saves a topic chosen, in the taxonomy's order", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings");
    fireEvent.click(screen.getByRole("button", { name: /旅行/u }));
    await settle();
    expect(patches).toStrictEqual([{ topics: ["daily", "work", "travel"] }]);
    expect(screen.getByRole("button", { name: /旅行/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("never lets the last topic go, and says why once it is pressed", async () => {
    const { patches } = serveSettings({
      ...PAGE,
      settings: { ...SETTINGS, topics: ["work"] },
    });
    await renderApp("/settings");
    const last = screen.getByRole("button", { name: /仕事/u });
    expect(last).toHaveAttribute("aria-disabled", "true");
    expect(last).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(ja.Settings.topics.keepOne)).toBeNull();
    fireEvent.click(last);
    await settle();
    expect(patches).toStrictEqual([]);
    expect(screen.getByText(ja.Settings.topics.keepOne)).toBeInTheDocument();
  });

  it("says which focus went with a removed topic", async () => {
    serveSettings(
      {
        ...PAGE,
        settings: { ...SETTINGS, focus: [{ topic: "work", subtopic: "meetings" }] },
      },
      { removedFocus: [{ topic: "work", subtopic: "meetings" }] },
    );
    await renderApp("/settings");
    fireEvent.click(screen.getByRole("button", { name: /仕事/u }));
    await settle();
    expect(
      screen.getByText(fill(ja.Settings.focus.removed, { names: "会議" })),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "会議" })).not.toBeInTheDocument();
  });
});

describe("the settings screen, W11 focus", () => {
  it("offers the chosen topics' subtopics and stops at two", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings");
    const focus = screen.getByRole("group", { name: ja.Settings.focus.title });
    expect(
      within(focus)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toStrictEqual(["家", "会議", "メール・チャット", "日程調整"]);
    fireEvent.click(within(focus).getByRole("button", { name: "会議" }));
    await settle();
    fireEvent.click(within(focus).getByRole("button", { name: "家" }));
    await settle();
    expect(patches.at(-1)).toStrictEqual({
      focus: [
        { topic: "work", subtopic: "meetings" },
        { topic: "daily", subtopic: "home" },
      ],
    });
    expect(within(focus).getByRole("button", { name: "日程調整" })).toBeDisabled();
    expect(
      screen.getByText(fill(ja.Settings.focus.count, { count: 2, max: 2 })),
    ).toBeInTheDocument();
    fireEvent.click(within(focus).getByRole("button", { name: "会議" }));
    await settle();
    expect(patches.at(-1)).toStrictEqual({
      focus: [{ topic: "daily", subtopic: "home" }],
    });
  });

  it("names a focus whose subtopic the taxonomy no longer lists by its id", async () => {
    serveSettings(
      {
        ...PAGE,
        settings: { ...SETTINGS, focus: [{ topic: "work", subtopic: "retired" }] },
      },
      { removedFocus: [{ topic: "work", subtopic: "retired" }] },
    );
    await renderApp("/settings");
    fireEvent.click(screen.getByRole("button", { name: /仕事/u }));
    await settle();
    expect(
      screen.getByText(fill(ja.Settings.focus.removed, { names: "retired" })),
    ).toBeInTheDocument();
  });
});

describe("the settings screen, W11 size and sound", () => {
  it("saves the daily size and says when it completes today", async () => {
    const { patches } = serveSettings(PAGE, { completedToday: true });
    await renderApp("/settings");
    const sizes = screen.getByRole("radiogroup", { name: ja.Settings.size.title });
    expect(
      within(sizes)
        .getAllByRole("radio")
        .map((size) => size.textContent),
    ).toStrictEqual(["5", "10", "15", "20", "30"]);
    expect(
      within(sizes).getByRole("radio", {
        name: fill(ja.Settings.size.count, { count: 10 }),
      }),
    ).toBeChecked();
    fireEvent.click(
      within(sizes).getByRole("radio", {
        name: fill(ja.Settings.size.count, { count: 5 }),
      }),
    );
    await settle();
    expect(patches).toStrictEqual([{ dailySize: 5 }]);
    expect(screen.getByText(ja.Settings.size.completed)).toBeInTheDocument();
  });

  it("switches the sound", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings");
    const toggle = screen.getByRole("switch", { name: ja.Settings.sound.title });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await settle();
    expect(patches).toStrictEqual([{ sound: false }]);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("goes back to what was saved, and says so, when a save fails", async () => {
    fakeApi((call) =>
      call.method === "GET"
        ? Response.json(PAGE)
        : Promise.reject(new TypeError("fetch failed")),
    );
    await renderApp("/settings");
    fireEvent.click(screen.getByRole("switch", { name: ja.Settings.sound.title }));
    await settle();
    expect(
      screen.getByRole("switch", { name: ja.Settings.sound.title }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Settings.saveFailed);
  });

  it("settles on the latest save when an earlier one answers after it", async () => {
    const answers: ((response: Response) => void)[] = [];
    fakeApi((call) =>
      call.method === "GET"
        ? Response.json(PAGE)
        : new Promise<Response>((resolve) => {
            answers.push(resolve);
          }),
    );
    await renderApp("/settings");
    const toggle = screen.getByRole("switch", { name: ja.Settings.sound.title });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await settle();
    const saved = (sound: boolean): Response =>
      Response.json({
        settings: { ...SETTINGS, sound },
        removedFocus: [],
        completedToday: false,
      } satisfies SettingsView);
    answers[1]?.(saved(true));
    await settle();
    answers[0]?.(saved(false));
    await settle();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("the settings screen, W12 measuring again", () => {
  it("asks first, and starts the placement on confirm", async () => {
    serveSettings();
    await renderApp("/settings");
    expect(
      screen.getByText(fill(ja.Records.toeic, { toeic: "730" })),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: ja.Settings.difficulty.retest }),
    );
    const sheet = screen.getByRole("dialog", { name: ja.Settings.retest.title });
    expect(within(sheet).getByText(ja.Settings.retest.body)).toBeInTheDocument();
    fireEvent.click(
      within(sheet).getByRole("button", { name: ja.Settings.retest.confirm }),
    );
    await settle();
    expect(where()).toBe("/drill?kind=placement");
  });

  it("says the difficulty is not measured before a placement", async () => {
    serveSettings({ ...PAGE, toeic: null });
    await renderApp("/settings");
    expect(screen.getByText(ja.Records.notMeasured)).toBeInTheDocument();
  });

  it("closes on cancel or Esc, and only then does Esc go back", async () => {
    serveSettings();
    await renderApp("/settings");
    fireEvent.click(
      screen.getByRole("button", { name: ja.Settings.difficulty.retest }),
    );
    fireEvent.click(screen.getByRole("button", { name: ja.Settings.retest.cancel }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: ja.Settings.difficulty.retest }),
    );
    press("Escape");
    await settle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(where()).toBe("/settings");
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });
});

describe("the settings screen when the read fails", () => {
  it("says so, and reads the settings again on request", async () => {
    let attempts = 0;
    const calls = fakeApi(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : Response.json(PAGE);
    });
    await renderApp("/settings");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Settings.title }),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });
});
