import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ja from "../messages/ja.json";
import { HomeScreen } from "../src/components/home/home-screen";
import type { HomeState, StreakView } from "../src/core/home-state";
import type { Dot } from "../src/core/streak";
import { TUNING } from "../src/core/tuning";
import type { HomePreview, HomeView } from "../src/core/views";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("../src/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ push, refresh }),
}));

const COUNT: StreakView = { kind: "count", value: 12, yesterdayGap: false };

const WEEK: readonly Dot[] = [
  { day: "2026-09-21", state: "done" },
  { day: "2026-09-22", state: "gap" },
  { day: "2026-09-23", state: "upcoming" },
  { day: "2026-09-24", state: "upcoming" },
  { day: "2026-09-25", state: "upcoming" },
  { day: "2026-09-26", state: "upcoming" },
  { day: "2026-09-27", state: "upcoming" },
];

const PREVIEW: HomePreview = {
  size: 10,
  setting: 10,
  shortage: false,
  reviewCount: 4,
  newCount: 6,
  focusNames: ["meetings-ja"],
  minutes: 5,
};

function view(state: HomeState, overrides: Partial<HomeView> = {}): HomeView {
  return {
    state,
    week: WEEK,
    preview: PREVIEW,
    todayRounds: 2,
    todayCards: 20,
    dailySize: 10,
    sound: true,
    contentError: false,
    ...overrides,
  };
}

/** Fills a catalog template's `{name}` arguments. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)[^}]*\}/gu, (_, name: string) =>
    String(values[name]),
  );
}

function renderHome(home: HomeView): void {
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <HomeScreen view={home} />
    </NextIntlClientProvider>,
  );
}

function pressSpace(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", cancelable: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json({ settings: {}, removedFocus: [], completedToday: false }),
    ),
  );
});

describe("HomeScreen, W3a: today's portion not started", () => {
  it("shows the streak, the week, the size and the mix, and starts on the button", () => {
    renderHome(view({ kind: "ready", streak: COUNT }));
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(ja.Home.streakUnit)).toBeInTheDocument();
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const) {
      expect(screen.getByText(ja.Home.week[day])).toBeInTheDocument();
    }
    expect(
      screen.getByRole("heading", { name: ja.Home.today.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.today.size, { count: 10, minutes: 5 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        fill(ja.Home.today.mixFocus, { review: 4, fresh: 6, focus: "meetings-ja" }),
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.today.start }));
    expect(push).toHaveBeenLastCalledWith("/drill?kind=today");
  });

  it("leaves the focus out of the mix when none is chosen", () => {
    renderHome(
      view(
        { kind: "ready", streak: COUNT },
        { preview: { ...PREVIEW, focusNames: [] } },
      ),
    );
    expect(
      screen.getByText(fill(ja.Home.today.mix, { review: 4, fresh: 6 })),
    ).toBeInTheDocument();
  });

  it("says why the portion is smaller than the setting on a short day", () => {
    renderHome(
      view(
        { kind: "ready", streak: COUNT },
        { preview: { ...PREVIEW, size: 7, shortage: true, minutes: 4 } },
      ),
    );
    expect(
      screen.getByText(
        fill(ja.Home.today.sizeShort, { count: 7, minutes: 4, setting: 10 }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.today.shortage, { count: 7 })),
    ).toBeInTheDocument();
  });

  it("starts on Space, the screen's primary action", () => {
    renderHome(view({ kind: "ready", streak: COUNT }));
    pressSpace();
    expect(push).toHaveBeenLastCalledWith("/drill?kind=today");
  });

  it("leaves Space to a focused control, and ignores held or modified keys", () => {
    push.mockClear();
    renderHome(view({ kind: "ready", streak: COUNT }));
    const link = screen.getByRole("link", { name: ja.Home.records });
    fireEvent.keyDown(link, { key: " " });
    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    fireEvent.keyDown(window, { key: "a" });
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(push).toHaveBeenLastCalledWith("/drill?kind=today");
  });

  it("links to the records and the settings", () => {
    renderHome(view({ kind: "ready", streak: COUNT }));
    expect(screen.getByRole("link", { name: ja.Home.records })).toHaveAttribute(
      "href",
      "/records",
    );
    expect(screen.getByRole("link", { name: ja.Home.settings })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});

describe("HomeScreen, W3b: a portion under way", () => {
  it.each([
    ["today", ja.Home.progress.today],
    ["yesterday", ja.Home.progress.yesterday],
  ] as const)("resumes %s's portion where it stopped", (portion, title) => {
    push.mockClear();
    renderHome(
      view({
        kind: "in-progress",
        portion,
        progress: 4,
        target: 10,
        resumeKind: portion,
        streak: COUNT,
      }),
    );
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.progress.count, { done: 4, target: 10 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.progress.resume }));
    expect(push).toHaveBeenLastCalledWith(`/drill?kind=${portion}`);
  });
});

describe("HomeScreen, W3c: today's portion done", () => {
  it("counts today's rounds and offers one more round of the daily size", () => {
    renderHome(
      view({ kind: "done", restoresTo: null, streak: { ...COUNT, value: 13 } }),
    );
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
    pressSpace();
    expect(push).toHaveBeenLastCalledWith("/drill?kind=extra");
    expect(
      screen.getByRole("button", { name: fill(ja.Home.done.more, { count: 10 }) }),
    ).toBeInTheDocument();
  });

  it("makes making up yesterday the primary action until the cut-off", () => {
    renderHome(view({ kind: "done", restoresTo: 14, streak: { ...COUNT, value: 1 } }));
    expect(
      screen.getByText(fill(ja.Home.done.restores, { days: 14 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Home.deadline, { hour: TUNING.dayBoundaryHour })),
    ).toBeInTheDocument();
    pressSpace();
    expect(push).toHaveBeenLastCalledWith("/drill?kind=yesterday");
    fireEvent.click(
      screen.getByRole("button", { name: fill(ja.Home.done.more, { count: 10 }) }),
    );
    expect(push).toHaveBeenLastCalledWith("/drill?kind=extra");
  });
});

describe("HomeScreen, W3d: too few cards", () => {
  it("says how many cards there are and points at the settings, with no start", () => {
    push.mockClear();
    renderHome(
      view({ kind: "not-enough", available: 3, streak: COUNT }, { preview: undefined }),
    );
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
    pressSpace();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("HomeScreen, W3e: yesterday open", () => {
  it("offers yesterday and today together, or a fresh start", () => {
    renderHome(
      view(
        {
          kind: "recover-offer",
          streak: { kind: "count", value: 12, yesterdayGap: true },
        },
        { preview: { ...PREVIEW, minutes: 10 } },
      ),
    );
    expect(screen.getByText(ja.Home.yesterdayGap)).toBeInTheDocument();
    expect(screen.getAllByText(ja.Home.week.gap).length).toBeGreaterThan(0);
    expect(screen.getByText(ja.Home.recover.hint)).toBeInTheDocument();
    expect(
      screen.getByText(
        fill(ja.Home.recover.size, { yesterday: 10, today: 10, minutes: 10 }),
      ),
    ).toBeInTheDocument();
    pressSpace();
    expect(push).toHaveBeenLastCalledWith("/drill?kind=yesterday");
    fireEvent.click(screen.getByRole("button", { name: ja.Home.recover.restart }));
    expect(push).toHaveBeenLastCalledWith("/drill?kind=today");
  });
});

describe("HomeScreen, W3f: after a break", () => {
  it("counts from today and names the longest run, never a 0", () => {
    renderHome(view({ kind: "ready", streak: { kind: "restart", longest: 21 } }));
    expect(
      screen.getByRole("heading", { name: ja.Home.restartTitle }),
    ).toBeInTheDocument();
    expect(screen.getByText(fill(ja.Home.longest, { days: 21 }))).toBeInTheDocument();
    expect(screen.queryByText(ja.Home.streakUnit)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ja.Home.today.start }),
    ).toBeInTheDocument();
  });
});

describe("HomeScreen when the cards cannot be read", () => {
  it("says so and reloads on request", () => {
    renderHome(
      view(
        { kind: "not-enough", available: 0, streak: COUNT },
        { contentError: true, preview: undefined },
      ),
    );
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("the sound switch", () => {
  it("says its state, and saves the change", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", (_: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return Promise.resolve(
        Response.json({ settings: {}, removedFocus: [], completedToday: false }),
      );
    });
    renderHome(view({ kind: "ready", streak: COUNT }));
    const toggle = screen.getByRole("button", { name: ja.Home.soundOn });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    expect(bodies).toStrictEqual([{ sound: false }]);
    expect(screen.getByRole("button", { name: ja.Home.soundOff })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("goes back when the change cannot be saved", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    renderHome(view({ kind: "ready", streak: COUNT }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ja.Home.soundOn }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: ja.Home.soundOn })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("settles on what the last save left, however the answers arrive", async () => {
    const pending: ((ok: boolean) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve, reject) => {
          pending.push((ok) => {
            if (ok)
              resolve(
                Response.json({
                  settings: {},
                  removedFocus: [],
                  completedToday: false,
                }),
              );
            else reject(new TypeError("fetch failed"));
          });
        }),
    );
    renderHome(view({ kind: "ready", streak: COUNT }));
    fireEvent.click(screen.getByRole("button", { name: ja.Home.soundOn }));
    fireEvent.click(screen.getByRole("button", { name: ja.Home.soundOff }));
    fireEvent.click(screen.getByRole("button", { name: ja.Home.soundOn }));
    await act(async () => {
      pending[2]?.(true);
      await Promise.resolve();
      await Promise.resolve();
      pending[0]?.(false);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: ja.Home.soundOff })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
