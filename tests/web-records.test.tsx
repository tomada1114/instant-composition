import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Dot, RecordsView } from "@instant-composition/web";

import {
  fakeApi,
  fakeTimers,
  fill,
  ja,
  navigations,
  press,
  renderApp,
  settle,
  type ApiCall,
} from "./web-harness";

// The records screen, W10, mounted as the whole app at `/records` over a
// stand-in API: the long view the records read answers, the breakdown opened
// in place, the weak points, the calendar and the titles, going back, and a
// failed read.

function calendar(done: number): Dot[][] {
  return Array.from({ length: 12 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => ({
      day: `w${String(week)}d${String(day)}`,
      state: week * 7 + day < done ? "done" : "upcoming",
    })),
  );
}

const RECORDS: RecordsView = {
  reach: {
    topics: [
      {
        id: "daily",
        name: "日常",
        count: 101,
        added: 0,
        ring: { from: 100, to: 200, done: 1, span: 100 },
      },
      {
        id: "work",
        name: "仕事",
        count: 91,
        added: 0,
        ring: { from: 50, to: 100, done: 41, span: 50 },
      },
    ],
    nearest: { name: "仕事", remaining: 9 },
  },
  breakdown: [
    { id: "daily", name: "日常", subtopics: [{ id: "home", name: "家", count: 101 }] },
    {
      id: "work",
      name: "仕事",
      subtopics: [
        { id: "meetings", name: "会議", count: 41 },
        { id: "email", name: "メール・チャット", count: 33 },
        { id: "schedule", name: "日程調整", count: 17 },
      ],
    },
  ],
  weak: {
    grammar: [
      { id: "en:grammar/present-perfect", name: "現在完了" },
      { id: "en:grammar/imperatives", name: "命令文・Let's" },
    ],
    subtopics: [
      { topic: "daily", subtopic: "home", name: "家" },
      { topic: "work", subtopic: "schedule", name: "日程調整" },
    ],
  },
  toeic: "730",
  levelMode: "auto",
  suggestedToeic: null,
  streak: { current: 13, longest: 21 },
  calendar: calendar(60),
  said: 2315,
  practicedDays: 79,
  points: 3105,
  titles: [
    { kind: "streak", values: [7, 14] },
    { kind: "reach", topic: "daily", name: "日常", values: [10, 25, 50, 100] },
  ],
};

/** An API that answers `records` for the records read. */
function serveRecords(records: RecordsView = RECORDS): ApiCall[] {
  return fakeApi((call) =>
    call.method === "GET" && call.url === "/api/v1/records"
      ? Response.json(records)
      : undefined,
  );
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

// The classes of the three colours with a job — `good`, `good-ink` and
// `energy` — which a records page never wears: nothing on it moved this session.
const LIT =
  ".text-good-ink, .bg-good-ink, .stroke-good-ink, .bg-good, .text-energy, .bg-energy";

describe("the records screen, W10", () => {
  it("shows the rings on its first tab, and the difficulty, the run and the totals on the history tab, with nothing lit", async () => {
    serveRecords();
    await renderApp("/records");
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Records.title }),
    ).toBeInTheDocument();
    expect(screen.getByText("101")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Summary.reach.nearest, { topic: "仕事", count: 9 })),
    ).toBeInTheDocument();
    expect(document.querySelector(LIT)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: ja.Records.tabs.history }));
    await settle();
    expect(
      screen.getByText(fill(ja.Records.toeic, { toeic: "730" })),
    ).toBeInTheDocument();
    expect(screen.getByText(fill(ja.Records.streak, { days: 13 }))).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Records.longest, { days: 21 })),
    ).toBeInTheDocument();
    expect(screen.getByText("2,315")).toBeInTheDocument();
    expect(screen.getByText("79")).toBeInTheDocument();
    expect(screen.getByText("3,105")).toBeInTheDocument();
    expect(document.querySelector(LIT)).toBeNull();
  });

  it.each([
    ["overview", ja.Summary.reach.infoLabel, ja.Summary.reach.info],
    ["weak", ja.Records.weak.infoLabel, ja.Records.weak.info],
    ["history", ja.Records.rules.label, ja.Records.rules.streak],
  ] as const)(
    "folds the %s tab's counting rule behind its button until asked",
    async (tab, label, text) => {
      serveRecords();
      await renderApp(`/records?tab=${tab}`);
      const button = screen.getByRole("button", { name: label });
      expect(screen.getByText(text)).not.toBeVisible();
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(text)).toBeVisible();
    },
  );

  it("opens one topic's breakdown in place, bars relative to its largest subtopic", async () => {
    serveRecords();
    await renderApp("/records");
    const toggle = screen.getByRole("button", {
      name: fill(ja.Records.breakdown, { topic: "仕事" }),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("会議")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rows = within(
      screen.getByRole("list", { name: fill(ja.Records.breakdown, { topic: "仕事" }) }),
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toStrictEqual([
      "会議41",
      "メール・チャット33",
      "日程調整17",
    ]);
    const fills = rows.map(
      (row) => row.querySelector<HTMLElement>("[data-part='fill']")?.style.width,
    );
    expect(fills[0]).toBe("100%");
    expect(fills[2]).toBe(`${String((17 / 41) * 100)}%`);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("会議")).not.toBeInTheDocument();
  });

  it("draws twelve weeks of dots and lists the titles, streak first", async () => {
    serveRecords();
    await renderApp("/records?tab=history");
    const dots = screen.getByRole("img", { name: ja.Records.calendar });
    expect(dots.querySelectorAll("[data-state]")).toHaveLength(84);
    expect(dots.querySelectorAll("[data-state='done']")).toHaveLength(60);
    const titles = screen.getByRole("region", { name: ja.Records.titles.title });
    const names = within(titles)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(names).toStrictEqual([ja.Records.titles.streak, "日常"]);
    expect(within(titles).getByText("7 · 14")).toBeInTheDocument();
    expect(within(titles).getByText("10 · 25 · 50 · 100")).toBeInTheDocument();
    const rows = titles.querySelector("dl");
    expect(rows).toHaveAttribute("tabindex", "0");
    expect(rows).toHaveAccessibleName(ja.Records.titles.title);
  });

  it("names the weak grammar and scenes, weakest first, with no count beside them", async () => {
    serveRecords();
    await renderApp("/records?tab=weak");
    const weak = screen.getByRole("region", { name: ja.Records.weak.title });
    expect(
      within(weak)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toStrictEqual([ja.Records.weak.grammar, ja.Records.weak.subtopics]);
    expect(
      within(weak)
        .getAllByRole("definition")
        .map((definition) => definition.textContent),
    ).toStrictEqual(["現在完了、命令文・Let's", "家、日程調整"]);
    expect(document.querySelector(LIT)).toBeNull();
  });

  it("leaves out a kind with nothing weak in it", async () => {
    serveRecords({
      ...RECORDS,
      weak: {
        grammar: [],
        subtopics: [{ topic: "work", subtopic: "email", name: "メール" }],
      },
    });
    await renderApp("/records?tab=weak");
    const weak = screen.getByRole("region", { name: ja.Records.weak.title });
    expect(
      within(weak)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toStrictEqual([ja.Records.weak.subtopics]);
    expect(within(weak).queryByText(ja.Records.weak.none)).toBeNull();
  });

  it("carries the one navigation, the records current", async () => {
    serveRecords();
    await renderApp("/records?tab=weak");
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/talk", null],
        ["/records", "page"],
        ["/settings", null],
      ],
    ]);
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.home }));
    await settle();
    expect(where()).toBe("/");
  });

  it("goes home on Esc", async () => {
    serveRecords();
    await renderApp("/records?tab=history");
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });
});

describe("the records screen, W10 difficulty", () => {
  it("says the level moves by itself in auto, with no suggestion beside it", async () => {
    serveRecords();
    await renderApp("/records?tab=history");
    expect(screen.getByText(ja.Records.auto)).toBeInTheDocument();
    expect(screen.queryByText(ja.Records.manual)).not.toBeInTheDocument();
  });

  it("shows the level the answers suggest beside one picked by hand", async () => {
    serveRecords({ ...RECORDS, levelMode: "manual", suggestedToeic: "800" });
    await renderApp("/records?tab=history");
    expect(
      screen.getByText(fill(ja.Records.toeic, { toeic: "730" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Records.suggested, { toeic: "800" })),
    ).toBeInTheDocument();
  });

  it("says only that the level is picked by hand while the answers suggest nothing", async () => {
    serveRecords({ ...RECORDS, levelMode: "manual" });
    await renderApp("/records?tab=history");
    expect(screen.getByText(ja.Records.manual)).toBeInTheDocument();
  });
});

describe("the records screen, W10 empty", () => {
  it("shows grooves, one line, day 1 after a break, no titles yet and nothing weak", async () => {
    serveRecords({
      ...RECORDS,
      reach: {
        topics: RECORDS.reach.topics.map((topic) => ({
          ...topic,
          count: 0,
          ring: { from: 0, to: 10, done: 0, span: 10 },
        })),
        nearest: { name: "日常", remaining: 10 },
      },
      toeic: null,
      streak: { current: 0, longest: 1 },
      titles: [],
      weak: { grammar: [], subtopics: [] },
    });
    await renderApp("/records");
    expect(screen.getByText(ja.Summary.reach.empty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: ja.Records.tabs.weak }));
    await settle();
    expect(
      within(screen.getByRole("region", { name: ja.Records.weak.title })).getByText(
        ja.Records.weak.none,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: ja.Records.tabs.history }));
    await settle();
    expect(screen.getByText(ja.Records.restart)).toBeInTheDocument();
    expect(screen.getByText(ja.Records.notMeasured)).toBeInTheDocument();
    expect(screen.getByText(ja.Records.titles.none)).toBeInTheDocument();
  });
});

/** The tablist the screen's heading names, as each tab's name and selection. */
function tabs(): (readonly [string | null, string | null])[] {
  return within(screen.getByRole("tablist", { name: ja.Records.title }))
    .getAllByRole("tab")
    .map((tab) => [tab.textContent, tab.getAttribute("aria-selected")] as const);
}

describe("the records screen, its tabs", () => {
  it("opens on the overview, with no ?tab= in the address", async () => {
    serveRecords();
    await renderApp("/records");
    expect(where()).toBe("/records");
    expect(tabs()).toStrictEqual([
      [ja.Records.tabs.overview, "true"],
      [ja.Records.tabs.weak, "false"],
      [ja.Records.tabs.history, "false"],
    ]);
    const panel = screen.getByRole("tabpanel", { name: ja.Records.tabs.overview });
    expect(within(panel).getByText("101")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: ja.Records.weak.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: ja.Records.calendar }),
    ).not.toBeInTheDocument();
  });

  it("switches tabs by click, replacing the address rather than adding to the history", async () => {
    serveRecords();
    await renderApp("/records");
    const entries = window.history.length;
    fireEvent.click(screen.getByRole("tab", { name: ja.Records.tabs.weak }));
    await settle();
    expect(where()).toBe("/records?tab=weak");
    expect(
      screen.getByRole("region", { name: ja.Records.weak.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText("101")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: ja.Records.tabs.history }));
    await settle();
    expect(where()).toBe("/records?tab=history");
    expect(screen.getByRole("img", { name: ja.Records.calendar })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: ja.Records.tabs.overview }));
    await settle();
    expect(where()).toBe("/records");
    expect(window.history.length).toBe(entries);
  });

  it("moves between tabs with the arrow keys, wrapping round, and Home and End", async () => {
    serveRecords();
    await renderApp("/records");
    const tab = (name: string): HTMLElement => screen.getByRole("tab", { name });
    tab(ja.Records.tabs.overview).focus();
    fireEvent.keyDown(tab(ja.Records.tabs.overview), { key: "ArrowLeft" });
    await settle();
    expect(where()).toBe("/records?tab=history");
    expect(tab(ja.Records.tabs.history)).toHaveFocus();
    expect(tab(ja.Records.tabs.history)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab(ja.Records.tabs.history), { key: "ArrowRight" });
    fireEvent.keyDown(tab(ja.Records.tabs.overview), { key: "ArrowRight" });
    await settle();
    expect(where()).toBe("/records?tab=weak");
    expect(tab(ja.Records.tabs.weak)).toHaveFocus();
    expect(
      screen.getByRole("tabpanel", { name: ja.Records.tabs.weak }),
    ).toBeInTheDocument();
    fireEvent.keyDown(tab(ja.Records.tabs.weak), { key: "End" });
    await settle();
    expect(where()).toBe("/records?tab=history");
    expect(tab(ja.Records.tabs.history)).toHaveFocus();
    fireEvent.keyDown(tab(ja.Records.tabs.history), { key: "Home" });
    await settle();
    expect(where()).toBe("/records");
    expect(tab(ja.Records.tabs.overview)).toHaveFocus();
  });

  it("keeps only the current tab in the Tab order, then its panel", async () => {
    serveRecords();
    await renderApp("/records?tab=weak");
    expect(
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("tabindex")),
    ).toStrictEqual(["-1", "0", "-1"]);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "0");
  });

  it("ties the current tab and its panel to each other, and no other tab to a panel", async () => {
    serveRecords();
    await renderApp("/records?tab=history");
    const panel = screen.getByRole("tabpanel");
    const current = screen.getByRole("tab", { name: ja.Records.tabs.history });
    expect(current).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", current.id);
    expect(
      screen
        .getAllByRole("tab")
        .filter((tab) => tab !== current)
        .map((tab) => tab.getAttribute("aria-controls")),
    ).toStrictEqual([null, null]);
  });

  it.each(["/records", "/records?tab=history"])(
    "is the column's height yet grows to fit at %s, its self-scrolling lists left out of that",
    async (path) => {
      serveRecords();
      await renderApp(path);
      const main = screen.getByRole("main");
      // A floor, never a fixed height: a tab taller than the column must
      // push the page longer, not slide under the tab bar.
      expect(main.className).toMatch(/(^|\s)min-h-\[calc\(var\(--column-height\)/u);
      expect(main.className).not.toMatch(/(^|\s)(h|max-h)-/u);
      const scrolls = [...main.querySelectorAll(".overflow-y-auto")];
      expect(scrolls).toHaveLength(1);
      for (const region of scrolls) expect(region).toHaveClass("contain-size");
    },
  );

  it("ignores other keys on a tab, and leaves Esc going home", async () => {
    serveRecords();
    await renderApp("/records?tab=weak");
    fireEvent.keyDown(screen.getByRole("tab", { name: ja.Records.tabs.weak }), {
      key: "ArrowDown",
    });
    await settle();
    expect(where()).toBe("/records?tab=weak");
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });

  it.each([
    ["/records?tab=weak", ja.Records.tabs.weak, "/records?tab=weak"],
    ["/records?tab=history", ja.Records.tabs.history, "/records?tab=history"],
    ["/records?tab=overview", ja.Records.tabs.overview, "/records?tab=overview"],
    ["/records?tab=level", ja.Records.tabs.overview, "/records"],
  ])("opens %s on its tab", async (path, name, address) => {
    serveRecords();
    await renderApp(path);
    expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name })).toBeInTheDocument();
    expect(where()).toBe(address);
  });
});

describe("the records screen before and instead of its read", () => {
  it("keeps the navigation standing, over an empty column, while the read is out", async () => {
    fakeApi(() => new Promise<Response>(() => undefined));
    await renderApp("/records");
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/talk", null],
        ["/records", "page"],
        ["/settings", null],
      ],
    ]);
    expect(document.querySelector("main")?.childElementCount).toBe(0);
  });

  it("keeps the navigation and Esc when the read fails", async () => {
    fakeApi(() => Promise.reject(new TypeError("fetch failed")));
    await renderApp("/records");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/talk", null],
        ["/records", "page"],
        ["/settings", null],
      ],
    ]);
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });

  it("says so, and reads the records again on request", async () => {
    let attempts = 0;
    const calls = fakeApi(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : Response.json(RECORDS);
    });
    await renderApp("/records");
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Records.title }),
    ).toBeInTheDocument();
    expect(calls.map((call) => call.url)).toStrictEqual([
      "/api/v1/records",
      "/api/v1/records",
    ]);
  });
});
