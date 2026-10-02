import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  LevelChoice,
  LevelView,
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
  landmarks,
  navigations,
  press,
  refusal,
  renderApp,
  settle,
  type ApiCall,
  warmUp,
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
  limitSeconds: 30,
  gradeKeys: { ok: "ArrowRight", ng: "ArrowLeft" },
};

const LEVELS: SettingsPageView["levels"] = [
  "300",
  "400",
  "500",
  "600",
  "730",
  "800",
  "860",
  "900",
  "950",
  "990+",
].map((toeic, index) => ({ level: index + 1, toeic }));

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
  difficulty: { mode: "auto", level: 5, toeic: "730" },
  levels: LEVELS,
};

/** The same page with the level fixed by hand, where the levels are offered. */
const MANUAL: SettingsPageView = {
  ...PAGE,
  difficulty: { mode: "manual", level: 5, toeic: "730" },
};

/**
 * An API that answers `page` for the settings read and saves every patch,
 * answering with `reply`'s extras; the patches it was sent are returned.
 */
function serveSettings(
  page: SettingsPageView = PAGE,
  reply: Partial<SettingsView> = {},
): {
  readonly patches: SettingsPatch[];
  readonly choices: LevelChoice[];
  readonly calls: ApiCall[];
} {
  const patches: SettingsPatch[] = [];
  const choices: LevelChoice[] = [];
  let settings = page.settings;
  let difficulty = page.difficulty;
  const calls = fakeApi((call) => {
    if (call.method === "PATCH" && call.url === "/api/v1/level") {
      const choice = call.body as LevelChoice;
      choices.push(choice);
      const level = choice.mode === "manual" ? choice.level : difficulty.level;
      difficulty = {
        mode: choice.mode,
        level,
        toeic: LEVELS.find((option) => option.level === level)?.toeic ?? null,
      } satisfies LevelView;
      return Response.json(difficulty);
    }
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
  return { patches, choices, calls };
}

function where(): string {
  return `${window.location.pathname}${window.location.search}`;
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

  it("shows the time limit saved and saves one picked, saying it applies from the next round", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings?tab=level");
    const limits = screen.getByRole("radiogroup", { name: ja.Settings.limit.title });
    expect(
      within(limits)
        .getAllByRole("radio")
        .map((limit) => limit.textContent),
    ).toStrictEqual(["15", "20", "30", "45", "60"]);
    expect(
      within(limits).getByRole("radio", {
        name: fill(ja.Settings.limit.count, { seconds: 30 }),
      }),
    ).toBeChecked();
    const section = limits.closest("section");
    expect(section).not.toBeNull();
    if (section !== null) {
      expect(within(section).getByText(ja.Settings.limit.next)).toBeInTheDocument();
    }
    fireEvent.click(
      within(limits).getByRole("radio", {
        name: fill(ja.Settings.limit.count, { seconds: 45 }),
      }),
    );
    await settle();
    expect(patches).toStrictEqual([{ limitSeconds: 45 }]);
    expect(
      within(limits).getByRole("radio", {
        name: fill(ja.Settings.limit.count, { seconds: 45 }),
      }),
    ).toBeChecked();
  });

  it("offers the time limit alone, with no answer mode", async () => {
    serveSettings();
    await renderApp("/settings?tab=level");
    expect(
      screen
        .getAllByRole("radiogroup")
        .map((group) => group.getAttribute("aria-label")),
    ).toStrictEqual([
      ja.Settings.difficulty.mode,
      ja.Settings.difficulty.levels,
      ja.Settings.limit.title,
    ]);
  });

  it("switches the sound", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings?tab=app");
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
    await renderApp("/settings?tab=app");
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
    await renderApp("/settings?tab=app");
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

  it.each([
    ["still in flight", false],
    ["already saved", true],
  ])(
    "takes back only a failed save's own change when a later one is %s",
    async (_state, laterAnswered) => {
      const answers: { resolve(r: Response): void; reject(e: Error): void }[] = [];
      fakeApi((call) =>
        call.method === "GET"
          ? Response.json(PAGE)
          : new Promise<Response>((resolve, reject) => {
              answers.push({ resolve, reject });
            }),
      );
      await renderApp("/settings");
      const travel = screen.getByRole("button", { name: /旅行/u });
      const five = (): HTMLElement =>
        screen.getByRole("radio", {
          name: fill(ja.Settings.size.count, { count: 5 }),
        });
      fireEvent.click(travel);
      await settle();
      fireEvent.click(five());
      await settle();
      if (laterAnswered) {
        answers[1]?.resolve(
          Response.json({
            settings: { ...SETTINGS, dailySize: 5 },
            removedFocus: [],
            completedToday: false,
          } satisfies SettingsView),
        );
        await settle();
      }
      answers[0]?.reject(new TypeError("fetch failed"));
      await settle();
      expect(travel).toHaveAttribute("aria-pressed", "false");
      expect(five()).toBeChecked();
      expect(screen.getByRole("alert")).toHaveTextContent(ja.Settings.saveFailed);
    },
  );
});

/** The level tab's retest button. */
function retest(): HTMLElement {
  return screen.getByRole("button", { name: ja.Settings.difficulty.retest });
}

/** A level option by its TOEIC reference. */
function option(toeic: string): HTMLElement {
  return screen.getByRole("radio", {
    name: fill(ja.Settings.difficulty.option, { toeic }),
  });
}

/** The level tab's controls as they stand: the mode chosen and the level checked. */
function expectLevel(mode: "auto" | "manual", toeic: string): void {
  expect(
    within(screen.getByRole("radiogroup", { name: ja.Settings.difficulty.levels }))
      .getAllByRole("radio")
      .filter((radio) => radio.getAttribute("aria-checked") === "true")
      .map((radio) => radio.textContent),
  ).toStrictEqual([toeic]);
  expect(
    screen.getByRole("radio", { name: ja.Settings.difficulty[mode] }),
  ).toHaveAttribute("aria-checked", "true");
}

describe("the settings screen, the grade keys", () => {
  /** The grade key button for `grade`, named by the key it shows now. */
  function keyButton(grade: "ok" | "ng", key: string): HTMLElement {
    return screen.getByRole("button", { name: fill(ja.Settings.keys[grade], { key }) });
  }

  function status(): HTMLElement {
    const [line] = screen
      .getAllByRole("status")
      .filter((element) => element.closest("[role=tabpanel]") !== null);
    if (line === undefined) throw new Error("No status line.");
    return line;
  }

  it("shows → and ← until others are chosen, then sets each key from the next one pressed", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings?tab=app");
    expect(
      screen.getByRole("group", { name: ja.Settings.keys.title }),
    ).toBeInTheDocument();

    fireEvent.click(keyButton("ok", "→"));
    const waiting = keyButton("ok", ja.Settings.keys.waiting);
    fireEvent.keyDown(waiting, { key: "l", code: "KeyL" });
    await settle();
    expect(patches).toStrictEqual([{ gradeKeys: { ok: "KeyL", ng: "ArrowLeft" } }]);
    expect(keyButton("ok", "L")).toHaveFocus();

    fireEvent.click(keyButton("ng", "←"));
    fireEvent.keyDown(keyButton("ng", ja.Settings.keys.waiting), {
      key: "1",
      code: "Digit1",
    });
    await settle();
    expect(patches).toStrictEqual([
      { gradeKeys: { ok: "KeyL", ng: "ArrowLeft" } },
      { gradeKeys: { ok: "KeyL", ng: "Digit1" } },
    ]);
    expect(keyButton("ng", "1")).toBeInTheDocument();
  });

  it("takes ↑ as a grade key, shown as the arrow", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings?tab=app");
    fireEvent.click(keyButton("ng", "←"));
    fireEvent.keyDown(keyButton("ng", ja.Settings.keys.waiting), {
      key: "ArrowUp",
      code: "ArrowUp",
    });
    await settle();
    expect(patches).toStrictEqual([{ gradeKeys: { ok: "ArrowRight", ng: "ArrowUp" } }]);
    expect(keyButton("ng", "↑")).toBeInTheDocument();
  });

  it.each([
    ["Space", " ", "Space"],
    ["Enter", "Enter", "Enter"],
    ["the key ? is on", "?", "Slash"],
    ["a keypad digit", "1", "Numpad1"],
    ["a function key", "F2", "F2"],
  ])("refuses %s and keeps waiting for another key", async (_, key, code) => {
    const { patches } = serveSettings();
    await renderApp("/settings?tab=app");
    fireEvent.click(keyButton("ok", "→"));
    fireEvent.keyDown(keyButton("ok", ja.Settings.keys.waiting), { key, code });
    await settle();
    expect(status()).toHaveTextContent(ja.Settings.keys.notAllowed);
    fireEvent.keyDown(keyButton("ok", ja.Settings.keys.waiting), {
      key: "k",
      code: "KeyK",
    });
    await settle();
    expect(patches).toStrictEqual([{ gradeKeys: { ok: "KeyK", ng: "ArrowLeft" } }]);
    expect(status()).toBeEmptyDOMElement();
  });

  it("refuses the other grade's key, so the two never share one", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings?tab=app");
    fireEvent.click(keyButton("ok", "→"));
    fireEvent.keyDown(keyButton("ok", ja.Settings.keys.waiting), {
      key: "ArrowLeft",
      code: "ArrowLeft",
    });
    await settle();
    expect(status()).toHaveTextContent(ja.Settings.keys.taken);
    expect(patches).toStrictEqual([]);
  });

  it("gives up on Esc without leaving the screen, and on leaving the key", async () => {
    const { patches } = serveSettings();
    await renderApp("/settings?tab=app");
    fireEvent.click(keyButton("ok", "→"));
    fireEvent.keyDown(keyButton("ok", ja.Settings.keys.waiting), {
      key: "Escape",
      code: "Escape",
    });
    await settle();
    expect(keyButton("ok", "→")).toBeInTheDocument();
    expect(where()).toBe("/settings?tab=app");

    fireEvent.click(keyButton("ng", "←"));
    fireEvent.blur(keyButton("ng", ja.Settings.keys.waiting));
    fireEvent.keyDown(keyButton("ng", "←"), { key: "j", code: "KeyJ" });
    await settle();
    expect(patches).toStrictEqual([]);
  });
});

describe("the settings screen, W12 measuring again", () => {
  it("asks first, and starts the placement on confirm", async () => {
    serveSettings();
    await renderApp("/settings?tab=level");
    expectLevel("auto", "730");
    fireEvent.click(retest());
    const sheet = screen.getByRole("dialog", { name: ja.Settings.retest.title });
    expect(within(sheet).getByText(ja.Settings.retest.body)).toBeInTheDocument();
    fireEvent.click(
      within(sheet).getByRole("button", { name: ja.Settings.retest.confirm }),
    );
    await settle();
    expect(where()).toBe("/drill?kind=placement");
  });

  it("shows no level chosen and no mode before a placement", async () => {
    serveSettings({
      ...PAGE,
      toeic: null,
      difficulty: { mode: "auto", level: null, toeic: null },
    });
    await renderApp("/settings?tab=level");
    expect(
      screen.queryByRole("radiogroup", { name: ja.Settings.difficulty.mode }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("radiogroup", { name: ja.Settings.difficulty.levels }))
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true"),
    ).toStrictEqual([]);
  });

  it("carries the one navigation, the settings current", async () => {
    serveSettings();
    await renderApp("/settings?tab=level");
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/talk", null],
        ["/records", null],
        ["/settings", "page"],
      ],
    ]);
    expect(landmarks()).toStrictEqual(["navigation", "main"]);
  });

  it("starts with the skip link, which moves focus to main", async () => {
    serveSettings();
    await renderApp("/settings");
    const first = document.querySelector("a[href], button, input, [tabindex]");
    const skip = screen.getByRole("link", { name: ja.Nav.skip });
    expect(first).toBe(skip);
    expect(skip).toHaveAttribute("href", "#main");
    fireEvent.click(skip);
    expect(screen.getByRole("main")).toHaveFocus();
    expect(where()).toBe("/settings");
  });

  it("closes on cancel or Esc, and only then does Esc go back", async () => {
    serveSettings();
    await renderApp("/settings?tab=level");
    fireEvent.click(retest());
    fireEvent.click(screen.getByRole("button", { name: ja.Settings.retest.cancel }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(retest());
    press("Escape");
    await settle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(where()).toBe("/settings?tab=level");
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });
});

describe("the settings screen, the difficulty", () => {
  it("shows the level auto has reached without offering the others", async () => {
    const { choices } = serveSettings();
    await renderApp("/settings?tab=level");
    expectLevel("auto", "730");
    for (const radio of within(
      screen.getByRole("radiogroup", { name: ja.Settings.difficulty.levels }),
    ).getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
    fireEvent.click(option("800"));
    await settle();
    expect(choices).toStrictEqual([]);
    expect(
      screen.getByText(fill(ja.Settings.difficulty.autoAt, { toeic: "730" })),
    ).toBeInTheDocument();
  });

  it("offers the levels once manual is chosen, and fixes the one picked", async () => {
    const { choices } = serveSettings();
    await renderApp("/settings?tab=level");
    fireEvent.click(screen.getByRole("radio", { name: ja.Settings.difficulty.manual }));
    await settle();
    expect(option("800")).toBeEnabled();
    fireEvent.click(option("800"));
    await settle();
    expect(choices).toStrictEqual([
      { mode: "manual", level: 5 },
      { mode: "manual", level: 6 },
    ]);
    expect(screen.getByText(ja.Settings.difficulty.manualNote)).toBeInTheDocument();
    expectLevel("manual", "800");
  });

  it("switches a level picked by hand back to auto, keeping the level", async () => {
    const { choices } = serveSettings(MANUAL);
    await renderApp("/settings?tab=level");
    expectLevel("manual", "730");
    fireEvent.click(screen.getByRole("radio", { name: ja.Settings.difficulty.auto }));
    await settle();
    expect(choices).toStrictEqual([{ mode: "auto" }]);
    expect(
      screen.getByText(fill(ja.Settings.difficulty.autoAt, { toeic: "730" })),
    ).toBeInTheDocument();
    expectLevel("auto", "730");
  });

  it("fixes the level as it is when manual is chosen without picking one", async () => {
    const { choices } = serveSettings();
    await renderApp("/settings?tab=level");
    fireEvent.click(screen.getByRole("radio", { name: ja.Settings.difficulty.manual }));
    await settle();
    expect(choices).toStrictEqual([{ mode: "manual", level: 5 }]);
  });

  it("offers only the levels before a placement, with nothing chosen", async () => {
    serveSettings({
      ...PAGE,
      toeic: null,
      difficulty: { mode: "auto", level: null, toeic: null },
    });
    await renderApp("/settings?tab=level");
    const levels = screen.getByRole("radiogroup", {
      name: ja.Settings.difficulty.levels,
    });
    expect(
      screen.queryByRole("radio", { name: ja.Settings.difficulty.manual }),
    ).not.toBeInTheDocument();
    expect(within(levels).getAllByRole("radio")).toHaveLength(10);
    expect(
      within(levels)
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true"),
    ).toStrictEqual([]);
  });

  it("rolls back to the newest change saved, whatever order the answers arrive in", async () => {
    const answers: ((response: Response) => void)[] = [];
    fakeApi((call) =>
      call.method === "GET"
        ? Response.json(MANUAL)
        : new Promise<Response>((resolve) => {
            answers.push(resolve);
          }),
    );
    await renderApp("/settings?tab=level");
    const view = (level: number, toeic: string): Response =>
      Response.json({ mode: "manual", level, toeic } satisfies LevelView);

    fireEvent.click(option("860"));
    fireEvent.click(option("900"));
    await settle();
    answers[1]?.(view(8, "900"));
    await settle();
    answers[0]?.(view(7, "860"));
    await settle();
    expect(option("900")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(option("300"));
    await settle();
    answers[2]?.(refusal(409, "ERR_CONFLICT"));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Settings.saveFailed);
    expect(option("900")).toHaveAttribute("aria-checked", "true");
  });

  it("says a change failed when another tab was opened before the answer", async () => {
    const answers: ((response: Response) => void)[] = [];
    fakeApi((call) =>
      call.method === "GET"
        ? Response.json(MANUAL)
        : new Promise<Response>((resolve) => {
            answers.push(resolve);
          }),
    );
    await renderApp("/settings?tab=level");
    fireEvent.click(option("300"));
    fireEvent.click(screen.getByRole("tab", { name: ja.Settings.tabs.cards }));
    await settle();
    answers[0]?.(refusal(409, "ERR_CONFLICT"));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Settings.saveFailed);
    fireEvent.click(screen.getByRole("tab", { name: ja.Settings.tabs.level }));
    await settle();
    expectLevel("manual", "730");
  });

  it("goes back to the level as saved, and says so, when a change fails", async () => {
    fakeApi((call) => {
      if (call.method === "GET" && call.url === "/api/v1/settings") {
        return Response.json(MANUAL);
      }
      return call.url === "/api/v1/level" ? refusal(409, "ERR_CONFLICT") : undefined;
    });
    await renderApp("/settings?tab=level");
    fireEvent.click(option("300"));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Settings.saveFailed);
    expectLevel("manual", "730");
  });
});

/** The tablist the screen's heading names, as each tab's name and selection. */
function tabs(): (readonly [string | null, string | null])[] {
  return within(screen.getByRole("tablist", { name: ja.Settings.title }))
    .getAllByRole("tab")
    .map((tab) => [tab.textContent, tab.getAttribute("aria-selected")] as const);
}

describe("the settings screen, its tabs", () => {
  it("opens on what is dealt, with no ?tab= in the address", async () => {
    serveSettings();
    await renderApp("/settings");
    expect(where()).toBe("/settings");
    expect(tabs()).toStrictEqual([
      [ja.Settings.tabs.cards, "true"],
      [ja.Settings.tabs.level, "false"],
      [ja.Settings.tabs.app, "false"],
    ]);
    const panel = screen.getByRole("tabpanel", { name: ja.Settings.tabs.cards });
    expect(within(panel).getByRole("button", { name: /旅行/u })).toBeInTheDocument();
    expect(
      within(panel).getByRole("radiogroup", { name: ja.Settings.size.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("switches tabs by click, replacing the address rather than adding to the history", async () => {
    serveSettings();
    await renderApp("/settings");
    const entries = window.history.length;
    fireEvent.click(screen.getByRole("tab", { name: ja.Settings.tabs.level }));
    await settle();
    expect(where()).toBe("/settings?tab=level");
    expect(retest()).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: ja.Settings.limit.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /旅行/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: ja.Settings.tabs.app }));
    await settle();
    expect(where()).toBe("/settings?tab=app");
    expect(
      screen.getByRole("switch", { name: ja.Settings.sound.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ja.Settings.signOut.action }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: ja.Settings.tabs.cards }));
    await settle();
    expect(where()).toBe("/settings");
    expect(window.history.length).toBe(entries);
  });

  it("moves between tabs with the arrow keys, wrapping round, and Home and End", async () => {
    serveSettings();
    await renderApp("/settings");
    const tab = (name: string): HTMLElement => screen.getByRole("tab", { name });
    tab(ja.Settings.tabs.cards).focus();
    fireEvent.keyDown(tab(ja.Settings.tabs.cards), { key: "ArrowRight" });
    await settle();
    expect(where()).toBe("/settings?tab=level");
    expect(tab(ja.Settings.tabs.level)).toHaveFocus();
    expect(tab(ja.Settings.tabs.level)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab(ja.Settings.tabs.level), { key: "ArrowLeft" });
    fireEvent.keyDown(tab(ja.Settings.tabs.cards), { key: "ArrowLeft" });
    await settle();
    expect(where()).toBe("/settings?tab=app");
    expect(tab(ja.Settings.tabs.app)).toHaveFocus();
    fireEvent.keyDown(tab(ja.Settings.tabs.app), { key: "ArrowRight" });
    await settle();
    expect(where()).toBe("/settings");
    fireEvent.keyDown(tab(ja.Settings.tabs.cards), { key: "End" });
    await settle();
    expect(where()).toBe("/settings?tab=app");
    expect(tab(ja.Settings.tabs.app)).toHaveFocus();
    fireEvent.keyDown(tab(ja.Settings.tabs.app), { key: "Home" });
    await settle();
    expect(tab(ja.Settings.tabs.cards)).toHaveFocus();
    expect(where()).toBe("/settings");
  });

  it("keeps only the current tab in the Tab order, then its panel", async () => {
    serveSettings();
    await renderApp("/settings?tab=app");
    expect(
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex")),
    ).toStrictEqual(["-1", "-1", "0"]);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "0");
  });

  it("ties the current tab and its panel to each other, and no other tab to a panel", async () => {
    serveSettings();
    await renderApp("/settings?tab=level");
    const panel = screen.getByRole("tabpanel");
    const current = screen.getByRole("tab", { name: ja.Settings.tabs.level });
    expect(current).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", current.id);
    expect(
      screen
        .getAllByRole("tab")
        .filter((tab) => tab !== current)
        .map((tab) => tab.getAttribute("aria-controls")),
    ).toStrictEqual([null, null]);
  });

  it("is as tall as its content", async () => {
    serveSettings();
    await renderApp("/settings");
    const main = screen.getByRole("main");
    // A screen is as tall as its content: no height of its own, and no
    // region scrolling inside it, so the page scrolls instead.
    for (const element of [main, main.firstElementChild]) {
      expect(element?.getAttribute("class")).not.toMatch(/(^|\s)(min-h|max-h|h)-/u);
    }
    expect(main.querySelectorAll(".overflow-y-auto, .contain-size")).toHaveLength(0);
  });

  it.each([
    ["/settings?tab=level", ja.Settings.tabs.level, "/settings?tab=level"],
    ["/settings?tab=app", ja.Settings.tabs.app, "/settings?tab=app"],
    ["/settings?tab=cards", ja.Settings.tabs.cards, "/settings?tab=cards"],
    ["/settings?tab=nothing", ja.Settings.tabs.cards, "/settings"],
  ])("opens %s on its tab", async (path, name, address) => {
    serveSettings();
    await renderApp(path);
    expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name })).toBeInTheDocument();
    expect(where()).toBe(address);
  });
});

describe("the settings screen before and instead of its read", () => {
  it("keeps the navigation standing, over an empty column, while the read is out", async () => {
    fakeApi(() => new Promise<Response>(() => undefined));
    await renderApp("/settings");
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/talk", null],
        ["/records", null],
        ["/settings", "page"],
      ],
    ]);
    expect(document.querySelector("main")?.childElementCount).toBe(0);
  });

  it("keeps the navigation and Esc when the read fails", async () => {
    fakeApi(() => Promise.reject(new TypeError("fetch failed")));
    await renderApp("/settings");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/talk", null],
        ["/records", null],
        ["/settings", "page"],
      ],
    ]);
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });

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
    expect(calls.filter((call) => call.url === "/api/v1/settings")).toHaveLength(2);
  });
});

describe("the settings screen, sign-out", () => {
  it("posts a top-level form to the logout endpoint", async () => {
    serveSettings();
    await renderApp("/settings?tab=app");
    const button = screen.getByRole("button", { name: ja.Settings.signOut.action });
    expect(button).toHaveAttribute("type", "submit");
    const form = button.closest("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/v1/auth/logout");
  });
});

describe("the settings screen, the time zone", () => {
  /** Serves the settings page and a profile in `zone`, saving each profile patch. */
  function serveProfile(zone: string): {
    readonly zones: string[];
    readonly calls: ApiCall[];
  } {
    const zones: string[] = [];
    let profile = { timeZone: zone, l1: "ja", target: "en", uiLocale: "ja" };
    const calls = fakeApi((call) => {
      if (call.method === "GET" && call.url === "/api/v1/settings") {
        return Response.json(PAGE);
      }
      if (call.method === "GET" && call.url === "/api/v1/me") {
        return Response.json(profile);
      }
      if (call.method === "PATCH" && call.url === "/api/v1/me") {
        const { timeZone } = call.body as { timeZone: string };
        zones.push(timeZone);
        profile = { ...profile, timeZone };
        return Response.json(profile);
      }
      return undefined;
    });
    return { zones, calls };
  }

  const device = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const other = device === "Pacific/Auckland" ? "Europe/London" : "Pacific/Auckland";

  it("reads the profile once a visit, not again each time the app tab opens", async () => {
    const { calls } = serveProfile(device);
    await renderApp("/settings");
    for (const name of [
      ja.Settings.tabs.app,
      ja.Settings.tabs.level,
      ja.Settings.tabs.app,
    ]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      await settle();
    }
    expect(
      screen.getByRole("combobox", { name: ja.Settings.timeZone.title }),
    ).toHaveValue(device);
    expect(
      calls.filter((call) => call.method === "GET" && call.url === "/api/v1/me"),
    ).toHaveLength(1);
  });

  it("stands the row by its name alone while the profile is being read", async () => {
    fakeApi((call) =>
      call.url === "/api/v1/settings"
        ? Response.json(PAGE)
        : new Promise<Response>(() => undefined),
    );
    await renderApp("/settings?tab=app");
    expect(
      screen.getByRole("heading", { name: ja.Settings.timeZone.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the stored zone and saves one picked through PATCH /v1/me", async () => {
    const { zones } = serveProfile(device);
    await renderApp("/settings?tab=app");
    const select = screen.getByRole("combobox", { name: ja.Settings.timeZone.title });
    expect(select).toHaveValue(device);
    expect(
      screen.queryByRole("button", {
        name: fill(ja.Settings.timeZone.useDevice, { zone: device }),
      }),
    ).toBeNull();
    fireEvent.change(select, { target: { value: other } });
    await settle();
    expect(zones).toStrictEqual([other]);
    expect(select).toHaveValue(other);
    expect(
      screen.getByText(fill(ja.Settings.timeZone.saved, { zone: other })),
    ).toBeInTheDocument();
  });

  it("offers this device's zone when the stored one differs", async () => {
    const { zones } = serveProfile(other);
    await renderApp("/settings?tab=app");
    fireEvent.click(
      screen.getByRole("button", {
        name: fill(ja.Settings.timeZone.useDevice, { zone: device }),
      }),
    );
    await settle();
    expect(zones).toStrictEqual([device]);
    expect(
      screen.getByRole("combobox", { name: ja.Settings.timeZone.title }),
    ).toHaveValue(device);
  });

  it("keeps the latest save when an earlier one fails after it", async () => {
    let failFirst: (() => void) | undefined;
    const profile = { timeZone: device, l1: "ja", target: "en", uiLocale: "ja" };
    fakeApi((call) => {
      if (call.method === "GET" && call.url === "/api/v1/settings") {
        return Response.json(PAGE);
      }
      if (call.method === "GET" && call.url === "/api/v1/me") {
        return Response.json(profile);
      }
      if (call.method === "PATCH" && call.url === "/api/v1/me") {
        const { timeZone } = call.body as { timeZone: string };
        if (failFirst === undefined) {
          return new Promise<Response>((resolve) => {
            failFirst = () => {
              resolve(refusal(503, "ERR_UNAVAILABLE"));
            };
          });
        }
        return Response.json({ ...profile, timeZone });
      }
      return undefined;
    });
    await renderApp("/settings?tab=app");
    const [first, second] = [
      "Europe/London",
      "Pacific/Auckland",
      "America/Chicago",
    ].filter((zone) => zone !== device);
    const select = screen.getByRole("combobox", { name: ja.Settings.timeZone.title });
    fireEvent.change(select, { target: { value: first } });
    await settle();
    fireEvent.change(select, { target: { value: second } });
    await settle();
    failFirst?.();
    await settle();
    expect(select).toHaveValue(second);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
