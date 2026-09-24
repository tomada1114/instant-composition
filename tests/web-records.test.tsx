import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Dot, RecordsView } from "@instant-composition/web";

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

// The records screen, W10, mounted as the whole app at `/records` over a
// stand-in API: the long view the records read answers, the breakdown opened
// in place, the calendar and the titles, going back, and a failed read.

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
  toeic: "730",
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

describe("the records screen, W10", () => {
  it("shows the rings, the difficulty, the run and the totals, with no accent", async () => {
    serveRecords();
    await renderApp("/records");
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Records.title }),
    ).toBeInTheDocument();
    expect(screen.getByText("101")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Summary.reach.nearest, { topic: "仕事", count: 9 })),
    ).toBeInTheDocument();
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
    expect(
      document.querySelector(".text-accent, .bg-accent, .stroke-accent"),
    ).toBeNull();
  });

  it("folds the counting rules behind their buttons until asked", async () => {
    serveRecords();
    await renderApp("/records");
    for (const [label, text] of [
      [ja.Summary.reach.infoLabel, ja.Summary.reach.info],
      [ja.Records.rules.label, ja.Records.rules.streak],
    ] as const) {
      const button = screen.getByRole("button", { name: label });
      expect(screen.getByText(text)).not.toBeVisible();
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(text)).toBeVisible();
    }
  });

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
    await renderApp("/records");
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
  });

  it("goes back on ← and on Esc", async () => {
    serveRecords();
    await renderApp("/records");
    expect(screen.getByRole("link", { name: ja.Records.back })).toHaveAttribute(
      "href",
      "/",
    );
    press("Escape");
    await settle();
    expect(where()).toBe("/");
  });
});

describe("the records screen, W10 empty", () => {
  it("shows grooves, one line, day 1 after a break, and no titles yet", async () => {
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
    });
    await renderApp("/records");
    expect(screen.getByText(ja.Summary.reach.empty)).toBeInTheDocument();
    expect(screen.getByText(ja.Records.restart)).toBeInTheDocument();
    expect(screen.getByText(ja.Records.notMeasured)).toBeInTheDocument();
    expect(screen.getByText(ja.Records.titles.none)).toBeInTheDocument();
  });
});

describe("the records screen when the read fails", () => {
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
