import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ANSWER_FIELD_MAX,
  AnswerField,
  BoltGlyph,
  Button,
  cn,
  FlameGlyph,
  HiddenAnswer,
  Segmented,
  Dialog,
  StarGlyph,
  TalkLine,
  TargetGlyph,
  WaitingLine,
} from "@instant-composition/web";

// The shadcn/ui button copied into the web client, the `cn` it calls, and the
// dialog. What is asserted is the wiring, not the styling: that a caller's own
// `className` wins over the component's default, which is the one behaviour
// of `cn` a component's appearance depends on. No class list is pinned beyond
// that, the button's lip, press and hover, and the dialog's breakpoint classes —
// jsdom evaluates no stylesheet, so those classes are the only trace a test can
// see of them, and a test restating more would fail on every legitimate
// restyle, which is `designing-ui`'s subject, not this file's.

describe("cn", () => {
  it("lets the later of two conflicting Tailwind utilities win", () => {
    expect(cn("p-2", "p-8")).toBe("p-8");
  });

  it("keeps utilities that do not conflict, and drops falsy input", () => {
    expect(cn("flex", false, undefined, "p-8")).toBe("flex p-8");
  });

  // `apps/web/src/globals.css` adds its own size, radius and container names,
  // which `twMerge` would otherwise misfile: a size read as a color is
  // dropped beside a real one, and an unknown radius survives beside the
  // utility meant to replace it. Each name must still conflict with its own
  // kind and nothing else.
  it.each([
    ["a type-scale size beside a theme color", "text-answer", "text-muted-foreground"],
    ["a type-scale size beside the display family", "text-number-xl", "font-display"],
    ["a radius token beside a padding", "rounded-card", "p-6"],
    ["the panel radius beside a padding", "rounded-panel", "p-6"],
    ["the reading width beside a width", "max-w-reading", "w-full"],
    ["the dialog width beside a width", "max-w-dialog", "w-full"],
    ["the lip beside the color it is painted", "shadow-lip", "shadow-action-lip"],
    ["the lip beside the control border's color", "shadow-lip", "shadow-input"],
    ["the count size beside the text on energy", "text-count", "text-on-energy"],
    ["the button size beside the text on action", "text-action", "text-on-action"],
    ["the button size beside the action fill", "text-action", "bg-action"],
    ["the action fill beside its text", "bg-action", "text-on-action"],
  ])("keeps %s, since the two do not conflict", (_, first, second) => {
    expect(cn(first, second)).toBe(`${first} ${second}`);
  });

  it.each([
    ["a type-scale size", "text-body", "text-answer"],
    ["a radius token", "rounded-card", "rounded-full"],
    ["a container token", "max-w-reading", "max-w-none"],
    ["two container tokens", "max-w-stage", "max-w-dashboard"],
    ["the control radius", "rounded-control", "rounded-card"],
    ["the panel radius", "rounded-card", "rounded-panel"],
    ["the count size", "text-body", "text-count"],
    ["the lip", "shadow-lip", "shadow-none"],
  ])("lets the later of two conflicting uses of %s win", (_, first, second) => {
    expect(cn(first, second)).toBe(second);
  });

  // Each colour `globals.css` adds, against one it replaces in the same
  // property: `cn("bg-raised", "bg-energy")` keeps only `bg-energy`.
  it.each([
    ["bg-raised", "bg-action"],
    ["bg-raised", "bg-action-hover"],
    ["bg-raised", "bg-energy"],
    ["bg-raised", "bg-energy-lip"],
    ["bg-raised", "bg-good"],
    ["bg-raised", "bg-good-hover"],
    ["bg-raised", "bg-good-ink"],
    ["bg-raised", "bg-bar-track"],
    ["hover:bg-raised", "hover:bg-action-hover"],
    ["text-foreground", "text-on-action"],
    ["text-foreground", "text-on-energy"],
    ["text-foreground", "text-on-good"],
    ["text-foreground", "text-good-ink"],
    ["text-foreground", "text-energy"],
    ["border-input", "border-energy"],
    ["shadow-input", "shadow-action-lip"],
    ["shadow-input", "shadow-energy-lip"],
    ["shadow-input", "shadow-good-lip"],
  ])("keeps only %s's replacement %s", (first, second) => {
    expect(cn(first, second)).toBe(second);
  });
});

describe("Button", () => {
  it("renders a button carrying its slot as a data attribute", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "data-slot",
      "button",
    );
  });

  it("renders the child element instead of a button when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/">Return to the home page</a>
      </Button>,
    );

    expect(
      screen.getByRole("link", { name: "Return to the home page" }),
    ).toHaveAttribute("data-slot", "button");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets a caller's className override the component's own default", () => {
    render(<Button className="px-8">Save</Button>);

    const { className } = screen.getByRole("button");
    expect(className).toContain("px-8");
    expect(className).not.toContain("px-6");
  });

  it("applies the variant it is given instead of the default one", () => {
    render(<Button variant="secondary">Save</Button>);

    const classes = screen.getByRole("button").className.split(" ");
    expect(classes).toContain("bg-card");
    expect(classes).not.toContain("bg-action");
  });

  it("stands the primary on its action lip, and drops it onto the lip while pressed", () => {
    render(<Button>Start</Button>);

    const classes = screen.getByRole("button").className.split(" ");
    expect(classes).toEqual(
      expect.arrayContaining([
        "bg-action",
        "shadow-lip",
        "shadow-action-lip",
        "active:translate-y-1",
        "active:shadow-none",
      ]),
    );
  });

  it.each(["primary", "good", "secondary", "text"] as const)(
    "gives the %s variant a hover state",
    (variant) => {
      render(<Button variant={variant}>Save</Button>);

      const hovers = screen
        .getByRole("button")
        .className.split(" ")
        .filter((name) => name.startsWith("hover:"));
      expect(hovers).not.toHaveLength(0);
    },
  );

  it("keeps its type-scale size when a caller sets a color", () => {
    render(
      <Button variant="secondary" className="text-muted-foreground">
        Save
      </Button>,
    );

    const classes = screen.getByRole("button").className.split(" ");
    expect(classes).toContain("text-action");
    expect(classes).toContain("text-muted-foreground");
    expect(classes).not.toContain("text-foreground");
  });
});

describe("Dialog", () => {
  // The one class list pinned here: jsdom lays nothing out, so the classes
  // are the only trace a test can see of where the dialog sits. None carries
  // a breakpoint: it is the same centered dialog at every width.
  function renderDialog(): HTMLElement {
    render(
      <Dialog titleId="dialog-title">
        <h2 id="dialog-title">Paused</h2>
      </Dialog>,
    );
    return screen.getByRole("dialog", { name: "Paused" });
  }

  it("opens centered over the scrim, at most 440 wide, every corner rounded", () => {
    const dialog = renderDialog();

    const scrim = dialog.parentElement?.className.split(" ") ?? [];
    expect(scrim).toEqual(
      expect.arrayContaining(["fixed", "inset-0", "items-center", "justify-center"]),
    );
    expect(scrim).toContain("bg-background/70");
    const panel = dialog.className.split(" ");
    expect(panel).toEqual(
      expect.arrayContaining([
        "max-w-dialog",
        "rounded-panel",
        "border-2",
        "bg-popover",
      ]),
    );
  });

  it("is the same dialog at every width: no class waits on a breakpoint", () => {
    const dialog = renderDialog();

    const classes = [
      ...(dialog.parentElement?.className.split(" ") ?? []),
      ...dialog.className.split(" "),
    ];
    expect(classes.filter((name) => name.includes(":"))).toStrictEqual([]);
    expect(classes).not.toContain("items-end");
  });
});

describe("Segmented", () => {
  const options = [
    { value: "a", label: "Alpha", text: "A" },
    { value: "b", label: "Beta", text: "B" },
    { value: "c", label: "Gamma", text: "C" },
  ] as const;

  function Harness({
    initial,
    onWindowKey,
  }: Readonly<{ initial: "a" | "b" | "c" | null; onWindowKey?: () => void }>) {
    const [value, setValue] = useState<"a" | "b" | "c" | null>(initial);
    useEffect(() => {
      if (onWindowKey === undefined) return;
      window.addEventListener("keydown", onWindowKey);
      return () => {
        window.removeEventListener("keydown", onWindowKey);
      };
    }, [onWindowKey]);
    return (
      <Segmented label="Pick" options={options} value={value} onChange={setValue} />
    );
  }

  function tabbable(): string[] {
    return screen
      .getAllByRole("radio")
      .filter((radio) => radio.tabIndex === 0)
      .map((radio) => radio.getAttribute("aria-label") ?? "");
  }

  it("puts only the chosen segment in the tab order", () => {
    render(<Harness initial="b" />);
    expect(tabbable()).toEqual(["Beta"]);
  });

  it("puts the first segment in the tab order when none is chosen", () => {
    render(<Harness initial={null} />);
    expect(tabbable()).toEqual(["Alpha"]);
  });

  it.each([
    ["ArrowRight", "b", "Gamma"],
    ["ArrowDown", "b", "Gamma"],
    ["ArrowLeft", "b", "Alpha"],
    ["ArrowUp", "b", "Alpha"],
    ["ArrowRight", "c", "Alpha"],
    ["ArrowLeft", "a", "Gamma"],
    ["Home", "c", "Alpha"],
    ["End", "a", "Gamma"],
  ] as const)("moves focus and the choice on %s from %s to %s", (key, from, to) => {
    render(<Harness initial={from} />);
    const start = screen.getAllByRole("radio").find((radio) => radio.tabIndex === 0);
    start?.focus();
    fireEvent.keyDown(start ?? document.body, { key });
    const target = screen.getByRole("radio", { name: to });
    expect(target).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(target);
    expect(tabbable()).toEqual([to]);
  });

  it("keeps a handled arrow from reaching a window key listener", () => {
    const onWindowKey = vi.fn();
    render(<Harness initial="a" onWindowKey={onWindowKey} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Alpha" }), {
      key: "ArrowRight",
    });
    expect(onWindowKey).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Beta" }), { key: "Escape" });
    expect(onWindowKey).toHaveBeenCalledOnce();
  });
});

describe("AnswerField", () => {
  function Field({ onSend }: Readonly<{ onSend: () => void }>) {
    const [value, setValue] = useState("");
    return (
      <AnswerField label="Answer" value={value} onChange={setValue} onSend={onSend} />
    );
  }

  it("passes its enterKeyHint to the field", () => {
    render(
      <AnswerField
        label="Answer"
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        enterKeyHint="send"
      />,
    );
    expect(screen.getByRole("textbox", { name: "Answer" })).toHaveAttribute(
      "enterkeyhint",
      "send",
    );
  });

  it("sends on Enter instead of breaking the line", () => {
    const onSend = vi.fn();
    render(<Field onSend={onSend} />);
    const field = screen.getByRole("textbox", { name: "Answer" });
    fireEvent.change(field, { target: { value: "I was swamped." } });
    const enter = fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
    expect(enter).toBe(false);
    expect(field).toHaveValue("I was swamped.");
  });

  it("does not send on an Enter the browser marks as composing", () => {
    const onSend = vi.fn();
    render(<Field onSend={onSend} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send while an input method's composition is open", () => {
    const onSend = vi.fn();
    render(<Field onSend={onSend} />);
    const field = screen.getByRole("textbox");
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send on the Enter that arrives just after a composition ends, as Safari's does", () => {
    const onSend = vi.fn();
    render(<Field onSend={onSend} />);
    const field = screen.getByRole("textbox");
    fireEvent.compositionStart(field);
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores keys other than Enter", () => {
    const onSend = vi.fn();
    render(<Field onSend={onSend} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "a" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("stops input at 300 characters, with no spell checking", () => {
    render(<Field onSend={vi.fn()} />);
    const field = screen.getByRole("textbox");
    expect(ANSWER_FIELD_MAX).toBe(300);
    expect(field).toHaveAttribute("maxlength", "300");
    expect(field).toHaveAttribute("spellcheck", "false");
    expect(field).toHaveAttribute("autocorrect", "off");
  });
});

describe("TalkLine and WaitingLine", () => {
  it("puts the speaker over the body, and marks only the current turn", () => {
    render(
      <ul>
        <TalkLine speaker="Partner">Long time no see.</TalkLine>
        <TalkLine speaker="You" current>
          I was swamped.
        </TalkLine>
      </ul>,
    );
    const [earlier, current] = screen.getAllByRole("listitem");
    expect(earlier).toHaveTextContent("PartnerLong time no see.");
    expect(earlier).not.toHaveAttribute("data-current");
    expect(current).toHaveAttribute("data-current");
  });

  it("shows the next speaker over a still ellipsis a screen reader skips", () => {
    render(
      <ul>
        <WaitingLine speaker="Teacher" />
      </ul>,
    );
    const line = screen.getByRole("listitem");
    expect(line).toHaveTextContent("Teacher…");
    expect(screen.getByText("…")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("HiddenAnswer", () => {
  it("draws one bar per word, as wide as the word, and reads only its label", () => {
    const { container } = render(
      <HiddenAnswer answer="I've been  swamped" label="Hidden" />,
    );
    const bars = container.querySelectorAll("[data-slot=hidden-word]");
    expect([...bars].map((bar) => (bar as HTMLElement).style.width)).toEqual([
      "4ch",
      "4ch",
      "7ch",
    ]);
    expect(container).toHaveTextContent(/^Hidden$/u);
    expect(container.textContent).not.toContain("swamped");
  });
});

describe("the filled glyphs", () => {
  it.each([
    ["flame", FlameGlyph],
    ["bolt", BoltGlyph],
    ["target", TargetGlyph],
    ["star", StarGlyph],
  ])(
    "draws the %s solid in the current text color, hidden from a screen reader",
    (_, Glyph) => {
      const { container } = render(<Glyph />);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("fill", "currentColor");
    },
  );
});
