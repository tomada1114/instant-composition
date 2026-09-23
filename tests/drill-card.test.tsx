import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import ja from "../messages/ja.json";
import { CardBack, CardFront } from "../src/components/drill/flashcard";
import { IntroScreen } from "../src/components/drill/intro-screen";
import { PauseSheet } from "../src/components/drill/pause-sheet";
import { TimerBar } from "../src/components/drill/timer-bar";
import { TopStrip } from "../src/components/drill/top-strip";
import type { DrillCard } from "../src/core/views";

const CARD: DrillCard = {
  id: "c1",
  topic: "work",
  subtopic: "meetings",
  level: 3,
  words: 8,
  ja: "prompt-ja",
  en: "Can we push the meeting to next week?",
  alternatives: ["Could we move the meeting to next week?", "Can we postpone it?"],
  point: "push A to B",
  limitMs: 8000,
};

/** Fills a catalog template's `{name}` and `{name, number, ...}` arguments. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)[^}]*\}/gu, (_, name: string) =>
    String(values[name]),
  );
}

function renderWithMessages(element: ReactElement) {
  return render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe("CardFront", () => {
  it("shows the prompt, with no retry mark on the first pass", () => {
    renderWithMessages(<CardFront card={CARD} retry={false} hidden={false} />);
    expect(screen.getByText("prompt-ja")).toBeInTheDocument();
    expect(screen.queryByText(ja.Drill.card.again)).not.toBeInTheDocument();
  });

  it("marks a retry", () => {
    renderWithMessages(<CardFront card={CARD} retry hidden={false} />);
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
  });

  it("hides the prompt while paused", () => {
    renderWithMessages(<CardFront card={CARD} retry={false} hidden />);
    expect(screen.queryByText("prompt-ja")).not.toBeInTheDocument();
  });

  it("flips when pressed", () => {
    const onFlip = vi.fn();
    renderWithMessages(
      <CardFront card={CARD} retry={false} hidden={false} onFlip={onFlip} />,
    );
    fireEvent.click(screen.getByText("prompt-ja"));
    expect(onFlip).toHaveBeenCalledOnce();
  });
});

describe("CardBack", () => {
  it("shows the answer in English, the alternates, the point and the seconds to flip", () => {
    renderWithMessages(<CardBack card={CARD} mode="self" elapsedMs={2800} />);
    expect(screen.getByText("prompt-ja")).toBeInTheDocument();
    expect(screen.getByText(CARD.en)).toHaveAttribute("lang", "en");
    for (const alternative of CARD.alternatives) {
      expect(screen.getByText(alternative)).toBeInTheDocument();
    }
    expect(screen.getByText(ja.Drill.card.point)).toBeInTheDocument();
    expect(screen.getByText(CARD.point)).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.card.seconds, { seconds: "2.8" })),
    ).toBeInTheDocument();
  });

  it("says timed out and to review in place of the seconds", () => {
    renderWithMessages(<CardBack card={CARD} mode="timeout" elapsedMs={8000} />);
    expect(screen.getByText(ja.Drill.card.timedOut)).toBeInTheDocument();
    expect(screen.getByText(ja.Drill.card.review)).toBeInTheDocument();
    expect(
      screen.queryByText(fill(ja.Drill.card.seconds, { seconds: "8.0" })),
    ).not.toBeInTheDocument();
  });

  it("shows the fast chip on a fast ○", () => {
    renderWithMessages(
      <CardBack
        card={CARD}
        mode="self"
        elapsedMs={2100}
        feedback={{ result: "ok", fast: true }}
      />,
    );
    expect(
      screen.getByText(fill(ja.Drill.card.fast, { seconds: "2.1" })),
    ).toBeInTheDocument();
  });

  it("leaves out the alternates block when a card has none", () => {
    const { container } = renderWithMessages(
      <CardBack card={{ ...CARD, alternatives: [] }} mode="self" elapsedMs={1000} />,
    );
    expect(container.querySelectorAll("[lang=en]")).toHaveLength(1);
  });
});

describe("TopStrip", () => {
  it("names the pause button and shows the progress", () => {
    const onPause = vi.fn();
    renderWithMessages(
      <TopStrip pass="first" current={7} total={10} combo={0} onPause={onPause} />,
    );
    expect(
      screen.getByText(fill(ja.Drill.card.progress, { current: 7, total: 10 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.card.pause }));
    expect(onPause).toHaveBeenCalledOnce();
  });

  it("shows the retry progress during the retry pass", () => {
    renderWithMessages(
      <TopStrip
        pass="retry"
        current={1}
        total={3}
        combo={0}
        onPause={() => undefined}
      />,
    );
    expect(
      screen.getByText(fill(ja.Drill.card.retryProgress, { current: 1, total: 3 })),
    ).toBeInTheDocument();
  });

  it("shows the combo from 2 only", () => {
    const { container, rerender } = renderWithMessages(
      <TopStrip
        pass="first"
        current={2}
        total={10}
        combo={1}
        onPause={() => undefined}
      />,
    );
    expect(container.querySelector("[data-part=combo]")).toBeNull();
    rerender(
      <NextIntlClientProvider locale="ja" messages={ja}>
        <TopStrip
          pass="first"
          current={3}
          total={10}
          combo={3}
          onPause={() => undefined}
        />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("[data-part=combo]")).toHaveTextContent(
      `3${ja.Drill.card.comboLabel}`,
    );
  });
});

describe("TimerBar", () => {
  it("shows the whole seconds left, rounded up, and a fill in proportion", () => {
    const { container } = render(<TimerBar remainingMs={4200} limitMs={8000} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    const fill = container.querySelector("[data-part=fill]");
    expect(fill).toHaveStyle({ width: "52.5%" });
    expect(fill).toHaveAttribute("data-motion", "essential");
  });

  it("reads 0 with the fill gone at the limit", () => {
    const { container } = render(<TimerBar remainingMs={0} limitMs={8000} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(container.querySelector("[data-part=fill]")).toHaveStyle({ width: "0%" });
  });
});

describe("PauseSheet", () => {
  it("asks whether to stop here, and focuses continue", () => {
    renderWithMessages(
      <PauseSheet position={7} onQuit={() => undefined} onContinue={() => undefined} />,
    );
    expect(
      screen.getByRole("dialog", { name: ja.Drill.sheet.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.sheet.hint, { position: 7 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ja.Drill.sheet.continue })).toHaveFocus();
  });

  it("quits and continues through its buttons", () => {
    const onQuit = vi.fn();
    const onContinue = vi.fn();
    renderWithMessages(
      <PauseSheet position={1} onQuit={onQuit} onContinue={onContinue} />,
    );
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.sheet.quit }));
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.sheet.continue }));
    expect(onQuit).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("keeps Tab inside the sheet", () => {
    renderWithMessages(
      <PauseSheet position={1} onQuit={() => undefined} onContinue={() => undefined} />,
    );
    const quit = screen.getByRole("button", { name: ja.Drill.sheet.quit });
    const resume = screen.getByRole("button", { name: ja.Drill.sheet.continue });
    fireEvent.keyDown(resume, { key: "Tab" });
    expect(quit).toHaveFocus();
    fireEvent.keyDown(quit, { key: "Tab", shiftKey: true });
    expect(resume).toHaveFocus();
  });
});

describe("IntroScreen", () => {
  it("explains the first placement and starts on the button", () => {
    const onStart = vi.fn();
    renderWithMessages(<IntroScreen first count={10} onStart={onStart} />);
    expect(
      screen.getByRole("heading", {
        name: fill(ja.Drill.intro.titleFirst, { count: 10 }),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.intro.portion, { count: 10 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.intro.start }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("changes only the heading for a re-measure", () => {
    renderWithMessages(
      <IntroScreen first={false} count={10} onStart={() => undefined} />,
    );
    expect(
      screen.getByRole("heading", {
        name: fill(ja.Drill.intro.titleAgain, { count: 10 }),
      }),
    ).toBeInTheDocument();
  });
});
