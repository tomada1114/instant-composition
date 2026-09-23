import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ja from "../messages/ja.json";
import { RecapScreen } from "../src/components/summary/recap-screen";
import { SummaryScreen } from "../src/components/summary/summary-screen";
import type { RoundSummary } from "../src/core/views";
import { makeSummary } from "./summary-fixture";

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

/** Fills a catalog template's `{name}` arguments. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)[^}]*\}/gu, (_, name: string) =>
    String(values[name]),
  );
}

const onNext = vi.fn();

function renderSummary(summary: RoundSummary, mode: "live" | "recap" = "live"): void {
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <SummaryScreen summary={summary} mode={mode} dailySize={10} onNext={onNext} />
    </NextIntlClientProvider>,
  );
}

function pressSpace(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", cancelable: true }));
  });
}

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

/** Reduced motion shows every value final at once, which most cases below read. */
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
  }));
}

beforeEach(() => {
  push.mockClear();
  onNext.mockClear();
  stubReducedMotion(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SummaryScreen, W9", () => {
  it("shows the growth figures and the first three rows, the rest behind see all", () => {
    renderSummary(makeSummary());
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Summary.title.today }),
    ).toBeInTheDocument();
    const growth = section(ja.Summary.growth.title);
    expect(within(growth).getByText(ja.Summary.growth.faster)).toBeInTheDocument();
    expect(within(growth).getByText(ja.Summary.growth.fixed)).toBeInTheDocument();
    expect(within(growth).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(growth).getByText(fill(ja.Summary.growth.delta, { seconds: "1.2" })),
    ).toBeInTheDocument();
    const more = within(growth).getByRole("button", { name: ja.Summary.seeAll });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(within(growth).getAllByRole("listitem")).toHaveLength(5);
    expect(
      within(growth).getByRole("button", { name: ja.Summary.collapse }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("counts the misses and lists three of them, never grading them further", () => {
    renderSummary(makeSummary());
    const review = section(ja.Summary.review.title);
    expect(within(review).getByText("4")).toBeInTheDocument();
    expect(within(review).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(within(review).getByRole("button", { name: ja.Summary.seeAll }));
    expect(within(review).getAllByRole("listitem")).toHaveLength(4);
  });

  it("shows the streak, the reach, the points and the totals", () => {
    renderSummary(makeSummary());
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText(ja.Summary.streakUnit)).toBeInTheDocument();
    const reach = section(ja.Summary.reach.title);
    expect(within(reach).getByText("101")).toBeInTheDocument();
    expect(
      within(reach).getByText(fill(ja.Summary.reach.added, { count: 3 })),
    ).toBeInTheDocument();
    expect(
      within(reach).queryByText(fill(ja.Summary.reach.added, { count: 0 })),
    ).not.toBeInTheDocument();
    expect(
      within(reach).getByText(
        fill(ja.Summary.reach.nearest, { topic: "IT・技術", count: 42 }),
      ),
    ).toBeInTheDocument();
    expect(reach.querySelector("[data-layout='concentric']")).not.toBeNull();
    expect(
      screen.getByText(fill(ja.Summary.points.earned, { points: 20 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Summary.points.total, { points: "3,105" })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Summary.totals.line, { said: "2,315", days: 79 })),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: ja.Summary.totals.chart }),
    ).toBeInTheDocument();
  });

  it("ends on Space, and offers one more round of the daily size", () => {
    renderSummary(makeSummary());
    pressSpace();
    expect(push).toHaveBeenLastCalledWith("/");
    fireEvent.click(
      screen.getByRole("button", {
        name: fill(ja.Summary.actions.more, { count: 10 }),
      }),
    );
    expect(onNext).toHaveBeenLastCalledWith("extra");
    fireEvent.click(screen.getByRole("button", { name: ja.Summary.close }));
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("counts the changed values up, and only those", () => {
    stubReducedMotion(false);
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    renderSummary(makeSummary({ reach: { topics: [], nearest: null } }));
    expect(screen.getByText("12")).toBeInTheDocument();
    for (now = 16; frames.length > 0 && now < 5000; now += 100) {
      const frame = frames.shift();
      act(() => frame?.(now));
    }
    expect(screen.getByText("13")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe("SummaryScreen, a round with nothing to compare or review", () => {
  it("says what was compared and what was new, with no big 0", () => {
    renderSummary(
      makeSummary({
        growth: { faster: 0, fixed: 0, compared: 4, firstTime: 6, rows: [] },
        review: [],
      }),
    );
    expect(
      screen.getByText(fill(ja.Summary.growth.compared, { count: 4 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Summary.growth.firstTime, { count: 6 })),
    ).toBeInTheDocument();
    expect(screen.getByText(ja.Summary.review.none)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ja.Summary.seeAll }),
    ).not.toBeInTheDocument();
  });

  it("says only how many were new when nothing could be compared", () => {
    renderSummary(
      makeSummary({
        growth: { faster: 0, fixed: 0, compared: 0, firstTime: 10, rows: [] },
      }),
    );
    expect(
      screen.getByText(fill(ja.Summary.growth.firstTime, { count: 10 })),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(fill(ja.Summary.growth.compared, { count: 0 })),
    ).not.toBeInTheDocument();
  });
});

describe("SummaryScreen titles", () => {
  it("stacks every title reached, streak first, in the order the server gave", () => {
    renderSummary(
      makeSummary({ titles: ["streak:14", "reach:daily:100", "reach:work:25"] }),
    );
    const names = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(names).toStrictEqual([
      fill(ja.Summary.titles.streak, { days: 14 }),
      fill(ja.Summary.titles.reach, { topic: "日常", count: 100 }),
      fill(ja.Summary.titles.reach, { topic: "仕事", count: 25 }),
    ]);
  });
});

describe("SummaryScreen, W9y: yesterday made up", () => {
  it("goes on to today's portion when it is still open, with no one more", () => {
    renderSummary(makeSummary({ kind: "yesterday", yesterday: true, todayOpen: true }));
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Summary.title.yesterday }),
    ).toBeInTheDocument();
    pressSpace();
    expect(onNext).toHaveBeenLastCalledWith("today");
    fireEvent.click(screen.getByRole("button", { name: ja.Summary.actions.end }));
    expect(push).toHaveBeenLastCalledWith("/");
    expect(screen.queryByRole("button", { name: /もう/u })).not.toBeInTheDocument();
  });

  it("ends as the primary action when today is already done", () => {
    renderSummary(
      makeSummary({ kind: "yesterday", yesterday: true, todayOpen: false }),
    );
    expect(
      screen.queryByRole("button", { name: ja.Summary.actions.today }),
    ).not.toBeInTheDocument();
    pressSpace();
    expect(push).toHaveBeenLastCalledWith("/");
  });
});

describe("SummaryScreen, W9r: re-reading today", () => {
  it("shows every value final, keeps the accent, and has no buttons below", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    renderSummary(makeSummary(), "recap");
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Summary.title.recap }),
    ).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(frames).toHaveLength(0);
    expect(screen.getByRole("link", { name: /戻る/u })).toHaveAttribute("href", "/");
    expect(
      screen.queryByRole("button", { name: ja.Summary.actions.end }),
    ).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(push).toHaveBeenLastCalledWith("/");
  });
});

describe("RecapScreen", () => {
  it("reads today's last summary back, with no buttons below", () => {
    render(
      <NextIntlClientProvider locale="ja" messages={ja}>
        <RecapScreen summary={makeSummary()} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: ja.Summary.title.recap }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /もう/u })).not.toBeInTheDocument();
  });
});

describe("SummaryScreen, W9f: the first round", () => {
  it("leads with where the difficulty starts", () => {
    renderSummary(
      makeSummary({
        kind: "placement",
        placement: { level: 5, toeic: "600", first: true },
        growth: { faster: 0, fixed: 0, compared: 0, firstTime: 10, rows: [] },
      }),
    );
    expect(
      screen.getByText(fill(ja.Summary.placement.start, { toeic: "600" })),
    ).toBeInTheDocument();
  });

  it("says where the next rounds go after a re-test", () => {
    renderSummary(
      makeSummary({
        kind: "placement",
        placement: { level: 7, toeic: "730", first: false },
      }),
    );
    expect(
      screen.getByText(fill(ja.Summary.difficulty.line, { toeic: "730" })),
    ).toBeInTheDocument();
  });
});

describe("SummaryScreen difficulty and reach variants", () => {
  it.each([
    ["up", "↑", ja.Summary.difficulty.up],
    ["down", "↓", ja.Summary.difficulty.down],
  ] as const)(
    "marks a move %s in words as well as the arrow",
    (change, arrow, words) => {
      renderSummary(makeSummary({ difficulty: { change, toeic: "730" } }));
      expect(
        screen.getByText(fill(ja.Summary.difficulty.line, { toeic: "730" })),
      ).toBeInTheDocument();
      expect(screen.getByText(arrow)).toBeInTheDocument();
      expect(screen.getByText(words)).toHaveClass("sr-only");
    },
  );

  it("lays five topics out as a grid of single rings", () => {
    const topics = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      ja: id,
      count: 12,
      added: 0,
      ring: { from: 10, to: 25, done: 2, span: 15 },
    }));
    renderSummary(
      makeSummary({ reach: { topics, nearest: { ja: "a", remaining: 13 } } }),
    );
    expect(
      section(ja.Summary.reach.title).querySelector("[data-layout='grid']"),
    ).not.toBeNull();
  });

  it("shows empty grooves and one line before anything is mastered", () => {
    const topics = ["daily", "work"].map((id) => ({
      id,
      ja: id,
      count: 0,
      added: 0,
      ring: { from: 0, to: 10, done: 0, span: 10 },
    }));
    renderSummary(
      makeSummary({ reach: { topics, nearest: { ja: "daily", remaining: 10 } } }),
    );
    expect(screen.getByText(ja.Summary.reach.empty)).toBeInTheDocument();
  });

  it("counts from today after a break instead of showing a 0", () => {
    renderSummary(
      makeSummary({
        kind: "extra",
        streak: { value: 0, restart: true, changed: false },
      }),
    );
    expect(screen.getByText(ja.Summary.restartTitle)).toBeInTheDocument();
  });
});
