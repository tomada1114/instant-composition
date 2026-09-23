import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ja from "../messages/ja.json";
import { RecordsScreen } from "../src/components/records/records-screen";
import type { Dot } from "../src/core/streak";
import type { RecordsView } from "../src/core/views";

const push = vi.fn();

vi.mock("../src/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push }),
}));

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)[^}]*\}/gu, (_, name: string) =>
    String(values[name]),
  );
}

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
        ja: "日常",
        count: 101,
        added: 0,
        ring: { from: 100, to: 200, done: 1, span: 100 },
      },
      {
        id: "work",
        ja: "仕事",
        count: 91,
        added: 0,
        ring: { from: 50, to: 100, done: 41, span: 50 },
      },
    ],
    nearest: { ja: "仕事", remaining: 9 },
  },
  breakdown: [
    { id: "daily", ja: "日常", subtopics: [{ id: "home", ja: "家", count: 101 }] },
    {
      id: "work",
      ja: "仕事",
      subtopics: [
        { id: "meetings", ja: "会議", count: 41 },
        { id: "email", ja: "メール・チャット", count: 33 },
        { id: "schedule", ja: "日程調整", count: 17 },
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
    { kind: "reach", topic: "daily", ja: "日常", values: [10, 25, 50, 100] },
  ],
};

function renderRecords(records: RecordsView): void {
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <RecordsScreen records={records} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
});

describe("RecordsScreen, W10", () => {
  it("shows the rings, the difficulty, the run and the totals, with no accent", () => {
    renderRecords(RECORDS);
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

  it("folds the counting rules behind their buttons until asked", () => {
    renderRecords(RECORDS);
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

  it("opens one topic's breakdown in place, bars relative to its largest subtopic", () => {
    renderRecords(RECORDS);
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
  });

  it("draws twelve weeks of dots and lists the titles, streak first", () => {
    renderRecords(RECORDS);
    const dots = screen.getByRole("img", { name: ja.Records.calendar });
    expect(dots.querySelectorAll("[data-state]")).toHaveLength(84);
    expect(dots.querySelectorAll("[data-state='done']")).toHaveLength(60);
    const titles = screen.getByRole("region", { name: ja.Records.titles.title });
    expect(within(titles).getByText(ja.Records.titles.streak)).toBeInTheDocument();
    expect(within(titles).getByText("7 · 14")).toBeInTheDocument();
    expect(within(titles).getByText("10 · 25 · 50 · 100")).toBeInTheDocument();
  });

  it("goes back on Esc", () => {
    renderRecords(RECORDS);
    expect(screen.getByRole("link", { name: /戻る/u })).toHaveAttribute("href", "/");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(push).toHaveBeenLastCalledWith("/");
  });
});

describe("RecordsScreen, W10 empty", () => {
  it("shows grooves, one line, day 1 after a break, and no titles yet", () => {
    renderRecords({
      ...RECORDS,
      reach: {
        topics: RECORDS.reach.topics.map((topic) => ({
          ...topic,
          count: 0,
          ring: { from: 0, to: 10, done: 0, span: 10 },
        })),
        nearest: { ja: "日常", remaining: 10 },
      },
      toeic: null,
      streak: { current: 0, longest: 1 },
      titles: [],
    });
    expect(screen.getByText(ja.Summary.reach.empty)).toBeInTheDocument();
    expect(screen.getByText(ja.Records.restart)).toBeInTheDocument();
    expect(screen.getByText(ja.Records.notMeasured)).toBeInTheDocument();
    expect(screen.getByText(ja.Records.titles.none)).toBeInTheDocument();
  });
});
