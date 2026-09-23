import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ja from "../messages/ja.json";
import { WelcomeScreen } from "../src/components/home/welcome-screen";
import type { TopicInfo } from "../src/core/types";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("../src/i18n/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const TOPICS: readonly TopicInfo[] = [
  {
    id: "work",
    ja: "仕事",
    subtopics: [
      { id: "meetings", ja: "会議" },
      { id: "requests", ja: "依頼" },
    ],
  },
  { id: "daily", ja: "日常", subtopics: [{ id: "home", ja: "家" }] },
];

function renderWelcome(topics: readonly TopicInfo[] = TOPICS): void {
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <WelcomeScreen topics={topics} />
    </NextIntlClientProvider>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  push.mockClear();
});

describe("WelcomeScreen, W1", () => {
  it("lists every topic with its subtopics, none chosen, and holds the next step back", () => {
    renderWelcome();
    expect(screen.getByRole("heading", { name: ja.Welcome.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /仕事/u })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("会議・依頼")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ja.Welcome.next })).toBeDisabled();
  });

  it("saves the chosen topics in the taxonomy's order and goes on to the placement", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", (_: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return Promise.resolve(
        Response.json({ settings: {}, removedFocus: [], completedToday: false }),
      );
    });
    renderWelcome();
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(screen.getByRole("button", { name: /仕事/u }));
    expect(screen.getByRole("button", { name: /仕事/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: ja.Welcome.next })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: ja.Welcome.next }));
    await settle();
    expect(bodies).toStrictEqual([{ topics: ["work", "daily"] }]);
    expect(push).toHaveBeenCalledWith("/drill?kind=placement");
  });

  it("drops a topic chosen twice, back to holding the next step", () => {
    renderWelcome();
    const work = screen.getByRole("button", { name: /仕事/u });
    fireEvent.click(work);
    fireEvent.click(work);
    expect(work).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: ja.Welcome.next })).toBeDisabled();
  });

  it("goes on with Enter once a topic is chosen", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({ settings: {}, removedFocus: [], completedToday: false }),
      ),
    );
    renderWelcome();
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    expect(push).toHaveBeenCalledWith("/drill?kind=placement");
  });

  it("stays and says so when the choice cannot be saved", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    renderWelcome();
    fireEvent.click(screen.getByRole("button", { name: /日常/u }));
    fireEvent.click(screen.getByRole("button", { name: ja.Welcome.next }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(ja.Welcome.saveFailed);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: ja.Welcome.next })).toBeEnabled();
  });

  it("says the cards could not be read, rather than offer nothing to choose", () => {
    renderWelcome([]);
    expect(
      screen.getByRole("heading", { name: ja.Home.loadFailed.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ja.Welcome.next }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    expect(refresh).toHaveBeenCalled();
  });
});
