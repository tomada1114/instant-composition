import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  CardBack,
  CardFront,
  CatalogProvider,
  GradeTrio,
  IntroScreen,
  PauseDialog,
  TimerBar,
  TopStrip,
  type DrillCard,
  type RoundPayload,
} from "@instant-composition/web";
import { fill, ja } from "./web-harness";

const CARD: DrillCard = {
  id: "c1",
  topic: "work",
  subtopic: "meetings",
  level: 3,
  words: 8,
  prompt: "prompt-ja",
  text: "Can we push the meeting to next week?",
  alternatives: ["Could we move the meeting to next week?", "Can we postpone it?"],
  explanation: "push A to B",
  limitMs: 8000,
  paceMs: 8000,
  intervals: { again: 1, hard: 2, good: 3 },
  isNew: true,
};

function renderWithMessages(element: ReactElement) {
  return render(<CatalogProvider>{element}</CatalogProvider>);
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

  it.each([
    { length: 48, size: "text-front" },
    { length: 49, size: "text-front-long" },
  ])(
    "sets a $length-character prompt at $size on the 880 stage",
    ({ length, size }) => {
      const prompt = "あ".repeat(length);
      renderWithMessages(
        <CardFront card={{ ...CARD, prompt }} retry={false} hidden={false} />,
      );
      expect(screen.getByText(prompt)).toHaveClass(size);
    },
  );

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
    expect(screen.getByText(CARD.text)).toHaveAttribute("lang", "en");
    for (const alternative of CARD.alternatives) {
      expect(screen.getByText(alternative)).toBeInTheDocument();
    }
    expect(screen.getByText(ja.Drill.card.point)).toBeInTheDocument();
    expect(screen.getByText(CARD.explanation)).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.card.seconds, { seconds: "2.8" })),
    ).toBeInTheDocument();
  });

  it("says timed out in place of the seconds, sending nothing to review by itself", () => {
    const { container } = renderWithMessages(
      <CardBack card={CARD} mode="timeout" elapsedMs={8000} />,
    );
    expect(screen.getByText(ja.Drill.card.timedOut).parentElement).toHaveTextContent(
      new RegExp(`^${ja.Drill.card.timedOut}$`, "u"),
    );
    expect(container).not.toHaveTextContent("復習");
    expect(
      screen.queryByText(fill(ja.Drill.card.seconds, { seconds: "8.0" })),
    ).not.toBeInTheDocument();
  });

  it("shows the fast mark on a fast ○", () => {
    renderWithMessages(
      <CardBack
        card={CARD}
        mode="self"
        elapsedMs={2100}
        feedback={{ grade: "good", fast: true }}
      />,
    );
    expect(
      screen.getByText(fill(ja.Drill.card.fast, { seconds: "2.1" })),
    ).toBeInTheDocument();
  });

  it.each([
    ["good", "text-good-ink"],
    ["again", "text-muted-foreground"],
  ] as const)("colours the answer for %s with %s", (grade, colour) => {
    renderWithMessages(
      <CardBack
        card={CARD}
        mode="self"
        elapsedMs={4000}
        feedback={{ grade, fast: false }}
      />,
    );
    expect(screen.getByText(CARD.text)).toHaveClass(colour);
  });

  it("leaves the answer ink on △", () => {
    renderWithMessages(
      <CardBack
        card={CARD}
        mode="self"
        elapsedMs={4000}
        feedback={{ grade: "hard", fast: false }}
      />,
    );
    const answer = screen.getByText(CARD.text);
    expect(answer).not.toHaveClass("text-good-ink");
    expect(answer).not.toHaveClass("text-muted-foreground");
  });

  it("leaves out the alternates block when a card has none", () => {
    const { container } = renderWithMessages(
      <CardBack card={{ ...CARD, alternatives: [] }} mode="self" elapsedMs={1000} />,
    );
    expect(container.querySelectorAll("[lang=en]")).toHaveLength(1);
  });
});

describe("TopStrip", () => {
  it("names the pause button and shows the first passes counted", () => {
    const onPause = vi.fn();
    renderWithMessages(
      <TopStrip
        current={7}
        total={10}
        filled={6}
        waiting={0}
        combo={0}
        onPause={onPause}
      />,
    );
    expect(
      screen.getByText(fill(ja.Drill.card.progress, { current: 7, total: 10 })),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(fill(ja.Drill.card.reAsks, { count: 0 })),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.card.pause }));
    expect(onPause).toHaveBeenCalledOnce();
  });

  it.each([
    { filled: 6, width: "60%" },
    { filled: 7, width: "70%" },
    { filled: 0, width: "0%" },
  ])("fills the progress bar to the share graded: $filled", ({ filled, width }) => {
    const { container } = renderWithMessages(
      <TopStrip
        current={7}
        total={10}
        filled={filled}
        waiting={0}
        combo={0}
        onPause={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-part=progress-fill]")).toHaveStyle({
      width,
    });
  });

  it("follows the count with 「もう一度 n」 while re-asks wait", () => {
    renderWithMessages(
      <TopStrip
        current={7}
        total={10}
        filled={7}
        waiting={1}
        combo={0}
        onPause={() => undefined}
      />,
    );
    expect(
      screen.getByText(fill(ja.Drill.card.reAsks, { count: 1 })),
    ).toBeInTheDocument();
  });

  it("shows the combo from 2 only", () => {
    const { container, rerender } = renderWithMessages(
      <TopStrip
        current={2}
        total={10}
        filled={1}
        waiting={0}
        combo={1}
        onPause={() => undefined}
      />,
    );
    expect(container.querySelector("[data-part=combo]")).toBeNull();
    rerender(
      <CatalogProvider>
        <TopStrip
          current={3}
          total={10}
          filled={3}
          waiting={0}
          combo={3}
          onPause={() => undefined}
        />
      </CatalogProvider>,
    );
    expect(container.querySelector("[data-part=combo]")).toHaveTextContent(
      `3${ja.Drill.card.comboLabel}`,
    );
  });
});

const NAMES = { again: "忘れた", hard: "微妙", good: "覚えてた" } as const;
const KEYS = { again: "ArrowLeft", hard: "Digit2", good: "ArrowRight" } as const;

describe("GradeTrio", () => {
  it("shows ×, △ and ○ left to right, each with its interval and its first key", () => {
    const onGrade = vi.fn();
    render(
      <GradeTrio
        names={NAMES}
        intervals={{ again: "明日", hard: "3 日", good: "8 日" }}
        keys={KEYS}
        onGrade={onGrade}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toStrictEqual([
      "忘れた 明日",
      "微妙 3 日",
      "覚えてた 8 日",
    ]);
    expect(buttons.map((button) => button.textContent)).toStrictEqual([
      "忘れた明日←",
      "微妙3 日2",
      "覚えてた8 日→",
    ]);
    expect(buttons[2]).toHaveClass("bg-good");
    expect(buttons[0]).not.toHaveClass("bg-good");
    expect(buttons[0]?.querySelector("[data-slot=kbd]")).toHaveClass("left-3.5");
    expect(buttons[1]?.querySelector("[data-slot=kbd]")).toHaveClass("right-3.5");
    fireEvent.click(screen.getByRole("button", { name: "微妙 3 日" }));
    expect(onGrade).toHaveBeenCalledWith("hard");
  });

  it("shows no intervals on a re-ask", () => {
    render(
      <GradeTrio names={NAMES} intervals={undefined} keys={KEYS} onGrade={vi.fn()} />,
    );
    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toStrictEqual(["忘れた", "微妙", "覚えてた"]);
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

const DEFAULT_KEYS = { ok: "ArrowRight", ng: "ArrowLeft", hard: "Digit2" };

/** The key legend's rows, each as its keys and what they do. */
function legend(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("dl > div")].map((row) =>
    [...row.children].map((cell) => cell.textContent),
  );
}

describe("PauseDialog", () => {
  it("lists the three grade keys, ← 1, 2 and → 3, while the learner keeps the default", () => {
    renderWithMessages(
      <PauseDialog
        position={1}
        gradeKeys={DEFAULT_KEYS}
        onQuit={() => undefined}
        onContinue={() => undefined}
      />,
    );
    expect(legend(document.body)).toStrictEqual([
      ["Space · Enter", ja.Drill.card.flip],
      ["← · 1", ja.Drill.grade.again],
      ["2", ja.Drill.grade.hard],
      ["→ · 3", ja.Drill.grade.good],
      ["Esc · ?", ja.Drill.card.pause],
    ]);
  });

  it("lists only the keys the learner chose", () => {
    renderWithMessages(
      <PauseDialog
        position={1}
        gradeKeys={{ ok: "Digit1", ng: "ArrowUp", hard: "KeyS" }}
        onQuit={() => undefined}
        onContinue={() => undefined}
      />,
    );
    expect(legend(document.body).slice(1, 4)).toStrictEqual([
      ["↑", ja.Drill.grade.again],
      ["S", ja.Drill.grade.hard],
      ["1", ja.Drill.grade.good],
    ]);
  });

  it("asks whether to stop here, and focuses continue", () => {
    renderWithMessages(
      <PauseDialog
        position={7}
        gradeKeys={DEFAULT_KEYS}
        onQuit={() => undefined}
        onContinue={() => undefined}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: ja.Drill.dialog.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.dialog.hint, { hour: 4, position: 7 })),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ja.Drill.dialog.continue }),
    ).toHaveFocus();
  });

  it("quits and continues through its buttons", () => {
    const onQuit = vi.fn();
    const onContinue = vi.fn();
    renderWithMessages(
      <PauseDialog
        position={1}
        gradeKeys={DEFAULT_KEYS}
        onQuit={onQuit}
        onContinue={onContinue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.dialog.quit }));
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.dialog.continue }));
    expect(onQuit).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("keeps Tab inside the dialog", () => {
    renderWithMessages(
      <PauseDialog
        position={1}
        gradeKeys={DEFAULT_KEYS}
        onQuit={() => undefined}
        onContinue={() => undefined}
      />,
    );
    const quit = screen.getByRole("button", { name: ja.Drill.dialog.quit });
    const resume = screen.getByRole("button", { name: ja.Drill.dialog.continue });
    fireEvent.keyDown(resume, { key: "Tab" });
    expect(quit).toHaveFocus();
    fireEvent.keyDown(quit, { key: "Tab", shiftKey: true });
    expect(resume).toHaveFocus();
  });
});

/** A placement round of ten cards, as the intro reads it. */
function introRound(): Pick<RoundPayload, "deck"> {
  return { deck: Array.from({ length: 10 }, (_, index) => `c${String(index)}`) };
}

describe("IntroScreen", () => {
  it("names the three moves of a card and starts on the button", () => {
    const onStart = vi.fn();
    renderWithMessages(<IntroScreen first round={introRound()} onStart={onStart} />);
    expect(
      screen.getByRole("heading", {
        name: fill(ja.Drill.intro.titleFirst, { count: 10 }),
      }),
    ).toBeInTheDocument();
    for (const step of [
      ja.Drill.intro.say,
      ja.Drill.intro.flip,
      ja.Drill.intro.grade,
    ]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.intro.start }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("changes only the heading for a re-measure", () => {
    renderWithMessages(
      <IntroScreen first={false} round={introRound()} onStart={() => undefined} />,
    );
    expect(
      screen.getByRole("heading", {
        name: fill(ja.Drill.intro.titleAgain, { count: 10 }),
      }),
    ).toBeInTheDocument();
  });
});
