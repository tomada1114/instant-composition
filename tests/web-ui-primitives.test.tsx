import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button, cn, Segmented, Sheet } from "@instant-composition/web";

// The shadcn/ui button copied into the web client, the `cn` it calls, and the
// sheet. What is asserted is the wiring, not the styling: that a caller's own
// `className` wins over the component's default, which is the one behaviour
// of `cn` a component's appearance depends on. No class list is pinned beyond
// that and the sheet's breakpoint classes — a test restating one would fail on
// every legitimate restyle, which is `designing-ui`'s subject, not this file's.

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
    ["the column width beside a width", "max-w-column", "w-full"],
  ])("keeps %s, since the two do not conflict", (_, first, second) => {
    expect(cn(first, second)).toBe(`${first} ${second}`);
  });

  it.each([
    ["a type-scale size", "text-body", "text-answer"],
    ["a radius token", "rounded-card", "rounded-full"],
    ["a container token", "max-w-column", "max-w-none"],
    ["the control radius", "rounded-control", "rounded-card"],
  ])("lets the later of two conflicting uses of %s win", (_, first, second) => {
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

    const { className } = screen.getByRole("button");
    expect(className).toContain("bg-raised");
    expect(className).not.toContain("bg-accent");
  });

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

describe("Sheet", () => {
  // The one class list pinned here: jsdom evaluates no media query, so the
  // `wide:` classes are the only trace a test can see of the sheet turning
  // into a centered dialog on a PC while staying a bottom sheet on a phone.
  function renderSheet(): HTMLElement {
    render(
      <Sheet titleId="sheet-title">
        <h2 id="sheet-title">Paused</h2>
      </Sheet>,
    );
    return screen.getByRole("dialog", { name: "Paused" });
  }

  it("rises from the bottom with its top corners rounded on a phone", () => {
    const dialog = renderSheet();

    expect(dialog.parentElement?.className.split(" ")).toContain("items-end");
    expect(dialog.className.split(" ")).toContain("rounded-t-card");
  });

  it("opens centered over the same scrim, every corner rounded, on a wide window", () => {
    const dialog = renderSheet();

    const scrim = dialog.parentElement?.className.split(" ");
    expect(scrim).toContain("wide:items-center");
    expect(scrim).toContain("bg-background/70");
    expect(dialog.className.split(" ")).toContain("wide:rounded-card");
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
