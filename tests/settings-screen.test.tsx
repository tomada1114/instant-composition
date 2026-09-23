import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ja from "../messages/ja.json";
import { SettingsScreen } from "../src/components/settings/settings-screen";
import type { Settings } from "../src/core/types";
import type { SettingsPageView, SettingsView } from "../src/core/views";

const push = vi.fn();

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
  useRouter: () => ({ push }),
}));

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)[^}]*\}/gu, (_, name: string) =>
    String(values[name]),
  );
}

const SETTINGS: Settings = {
  topics: ["daily", "work"],
  focus: [],
  dailySize: 10,
  sound: true,
};

const PAGE: SettingsPageView = {
  settings: SETTINGS,
  topics: [
    { id: "daily", ja: "日常", subtopics: [{ id: "home", ja: "家" }] },
    {
      id: "work",
      ja: "仕事",
      subtopics: [
        { id: "meetings", ja: "会議" },
        { id: "email", ja: "メール・チャット" },
        { id: "schedule", ja: "日程調整" },
      ],
    },
    { id: "travel", ja: "旅行", subtopics: [{ id: "airport", ja: "空港" }] },
  ],
  toeic: "730",
};

/** A server that saves whatever it is sent, answering with `reply`'s extras. */
function server(reply: Partial<SettingsView> = {}) {
  const bodies: unknown[] = [];
  let settings = SETTINGS;
  vi.stubGlobal("fetch", (_: string, init: RequestInit) => {
    const patch = JSON.parse(init.body as string) as Partial<Settings>;
    bodies.push(patch);
    settings = { ...settings, ...patch };
    return Promise.resolve(
      Response.json({ settings, removedFocus: [], completedToday: false, ...reply }),
    );
  });
  return bodies;
}

function renderSettings(page: SettingsPageView = PAGE): void {
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <SettingsScreen page={page} />
    </NextIntlClientProvider>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  push.mockClear();
});

describe("SettingsScreen, W11 topics", () => {
  it("saves a topic chosen, in the taxonomy's order", async () => {
    const bodies = server();
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /旅行/u }));
    await settle();
    expect(bodies).toStrictEqual([{ topics: ["daily", "work", "travel"] }]);
    expect(screen.getByRole("button", { name: /旅行/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("never lets the last topic go", () => {
    server();
    renderSettings({ ...PAGE, settings: { ...SETTINGS, topics: ["work"] } });
    expect(screen.getByRole("button", { name: /仕事/u })).toBeDisabled();
    expect(screen.getByText(ja.Settings.topics.keepOne)).toBeInTheDocument();
  });

  it("says which focus went with a removed topic", async () => {
    server({ removedFocus: [{ topic: "work", subtopic: "meetings" }] });
    renderSettings({
      ...PAGE,
      settings: { ...SETTINGS, focus: [{ topic: "work", subtopic: "meetings" }] },
    });
    fireEvent.click(screen.getByRole("button", { name: /仕事/u }));
    await settle();
    expect(
      screen.getByText(fill(ja.Settings.focus.removed, { names: "会議" })),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "会議" })).not.toBeInTheDocument();
  });
});

describe("SettingsScreen, W11 focus", () => {
  it("offers the chosen topics' subtopics and stops at two", async () => {
    const bodies = server();
    renderSettings();
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
    expect(bodies.at(-1)).toStrictEqual({
      focus: [
        { topic: "work", subtopic: "meetings" },
        { topic: "daily", subtopic: "home" },
      ],
    });
    expect(within(focus).getByRole("button", { name: "日程調整" })).toBeDisabled();
    expect(screen.getByText(ja.Settings.focus.limit)).toBeInTheDocument();
  });
});

describe("SettingsScreen, W11 size, sound and motion", () => {
  it("saves the daily size and says when it completes today", async () => {
    const bodies = server({ completedToday: true });
    renderSettings();
    const sizes = screen.getByRole("radiogroup", { name: ja.Settings.size.title });
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
    expect(bodies).toStrictEqual([{ dailySize: 5 }]);
    expect(screen.getByText(ja.Settings.size.completed)).toBeInTheDocument();
  });

  it("switches the sound, and shows the motion follows the system", async () => {
    const bodies = server();
    renderSettings();
    const toggle = screen.getByRole("switch", { name: ja.Settings.sound.title });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await settle();
    expect(bodies).toStrictEqual([{ sound: false }]);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(ja.Settings.motion.note)).toBeInTheDocument();
  });

  it("goes back to what was saved, and says so, when a save fails", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    renderSettings();
    fireEvent.click(screen.getByRole("switch", { name: ja.Settings.sound.title }));
    await settle();
    expect(
      screen.getByRole("switch", { name: ja.Settings.sound.title }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Settings.saveFailed);
  });
});

describe("SettingsScreen, W12 measuring again", () => {
  it("asks first, and starts the placement on confirm", () => {
    server();
    renderSettings();
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
    expect(push).toHaveBeenLastCalledWith("/drill?kind=placement");
  });

  it("closes on cancel or Esc, and only then does Esc go back", () => {
    server();
    renderSettings();
    fireEvent.click(
      screen.getByRole("button", { name: ja.Settings.difficulty.retest }),
    );
    fireEvent.click(screen.getByRole("button", { name: ja.Settings.retest.cancel }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: ja.Settings.difficulty.retest }),
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(push).toHaveBeenLastCalledWith("/");
  });
});
