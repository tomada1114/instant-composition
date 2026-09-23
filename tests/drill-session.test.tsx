import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ja from "../messages/ja.json";
import { DrillScreen } from "../src/components/drill/drill-screen";
import type { AnswerInput } from "../src/core/api";
import type { DrillCard, RoundPayload } from "../src/core/views";

const push = vi.fn();

vi.mock("../src/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push }),
}));

function card(id: string): DrillCard {
  return {
    id,
    topic: "work",
    subtopic: "meetings",
    level: 3,
    words: 6,
    ja: `prompt-${id}`,
    en: `answer-${id}`,
    alternatives: [],
    point: `point-${id}`,
    limitMs: 7000,
  };
}

const ROUND: RoundPayload = {
  id: "round-1",
  kind: "today",
  day: "2026-09-22",
  portionDay: "2026-09-22",
  deck: ["c1", "c2"],
  cards: { c1: card("c1"), c2: card("c2") },
  answered: [],
  offset: 0,
  total: 2,
  retries: true,
};

interface Call {
  readonly url: string;
  readonly body: unknown;
}

/** A server that answers the round, takes answers, and answers the summary. */
function fakeServer(options: { round?: RoundPayload; roundStatus?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) as unknown });
    if (url === "/api/rounds") {
      return Promise.resolve(
        options.roundStatus === undefined
          ? Response.json(options.round ?? ROUND)
          : Response.json(
              { error: { code: "ERR_NOT_ENOUGH_CARDS", available: 3 } },
              { status: options.roundStatus },
            ),
      );
    }
    if (url === "/api/answers")
      return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(Response.json({ roundId: "round-1" }));
  });
  return calls;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)[^}]*\}/gu, (_, name: string) =>
    String(values[name]),
  );
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function press(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
  });
}

async function renderDrill(kind: "today" | "placement" = "today"): Promise<void> {
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <DrillScreen kind={kind} first sound={false} />
    </NextIntlClientProvider>,
  );
  await settle();
  await settle(16);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("DrillScreen", () => {
  it("runs a round by keys, retries the miss, and finishes with every answer", async () => {
    const calls = fakeServer();
    await renderDrill();
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.announce.front, { ja: "prompt-c1", seconds: 7 })),
    ).toBeInTheDocument();

    await settle(2000);
    press(" ");
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    press("ArrowLeft");
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    await settle(200);
    press("j");
    await settle(400);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    // React flushes an update when its act() ends, so the frame that starts
    // the clock and the ticks after it are awaited separately.
    await settle(16);
    await settle(7100);
    expect(screen.getByText(ja.Drill.card.timedOut)).toBeInTheDocument();
    press(" ");
    await settle(16);
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    press(" ");
    await settle(200);
    press("ArrowRight");
    await settle(400);
    expect(screen.getByRole("heading", { name: ja.Drill.done.title })).toHaveFocus();

    const answers = calls.filter((call) => call.url === "/api/answers");
    expect(answers.map((call) => (call.body as AnswerInput).result)).toStrictEqual([
      "ok",
      "timeout",
      "ok",
    ]);
    const finish = calls.find((call) => call.url === "/api/rounds/finish");
    expect((finish?.body as { answers: unknown[] }).answers).toHaveLength(3);
  });

  it("pauses on Escape with the card hidden, and continues on Escape", async () => {
    fakeServer();
    await renderDrill();
    press("Escape");
    expect(
      screen.getByRole("dialog", { name: ja.Drill.sheet.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText("prompt-c1")).not.toBeInTheDocument();
    press("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("goes home from the sheet's stop button", async () => {
    fakeServer();
    await renderDrill();
    press("Escape");
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.sheet.quit }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("pauses when the page is hidden", async () => {
    fakeServer();
    await renderDrill();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(
      screen.getByRole("dialog", { name: ja.Drill.sheet.title }),
    ).toBeInTheDocument();
  });

  it("shows the explanation before a fresh placement round", async () => {
    fakeServer({ round: { ...ROUND, kind: "placement", retries: false } });
    await renderDrill("placement");
    expect(
      screen.getByRole("heading", {
        name: fill(ja.Drill.intro.titleFirst, { count: 2 }),
      }),
    ).toBeInTheDocument();
    press("Enter");
    await settle(16);
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("says when there are too few cards", async () => {
    fakeServer({ roundStatus: 409 });
    await renderDrill();
    expect(
      screen.getByRole("heading", { name: ja.Drill.error.notEnoughTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.error.notEnough, { count: 3 })),
    ).toBeInTheDocument();
  });

  it("offers a reload when the round could not be loaded", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(Response.json(ROUND));
    });
    await renderDrill();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.error.reload }));
    await settle();
    await settle(16);
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("shows a toast when an answer cannot be saved, and keeps going", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      url === "/api/rounds"
        ? Promise.resolve(Response.json(ROUND))
        : Promise.reject(new TypeError("fetch failed")),
    );
    await renderDrill();
    press(" ");
    await settle(200);
    press("ArrowRight");
    await settle(400);
    expect(screen.getByText(ja.Drill.save.failed)).toBeInTheDocument();
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();
    await settle(4000);
    expect(screen.queryByText(ja.Drill.save.failed)).not.toBeInTheDocument();
  });
});
