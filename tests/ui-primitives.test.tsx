import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cn } from "@/components/lib/utils";
import { Button } from "@/components/ui/button";

// The component copied in from the shadcn/ui registry, and the `cn` every
// such component calls. What is asserted is the wiring, not the styling: that
// the `@/` alias resolves under Vitest as well as under `tsc` and the Next.js
// build (this file imports through it on purpose), and that a caller's own
// `className` wins over the component's default, which is the one behaviour
// of `cn` a component's appearance depends on. No class list is pinned beyond
// that — a test restating one would fail on every legitimate restyle, which is
// `designing-ui`'s subject, not this file's.

describe("cn", () => {
  it("lets the later of two conflicting Tailwind utilities win", () => {
    expect(cn("p-2", "p-8")).toBe("p-8");
  });

  it("keeps utilities that do not conflict, and drops falsy input", () => {
    expect(cn("flex", false, undefined, "p-8")).toBe("flex p-8");
  });

  // `src/app/globals.css` adds its own size, radius, container and shadow
  // names, which `twMerge` would otherwise misfile: a size read as a color is
  // dropped beside a real one, and a shadow read as a shadow color survives
  // beside the utility meant to replace it. Each name must still conflict
  // with its own kind and nothing else.
  it.each([
    ["a type-scale size beside a theme color", "text-answer", "text-muted-foreground"],
    ["a type-scale size beside the Latin family", "text-number-lg", "font-latin"],
    ["a radius token beside a padding", "rounded-card", "p-6"],
    ["the column width beside a width", "max-w-column", "w-full"],
    ["the glow beside the accent color", "shadow-glow", "bg-accent"],
  ])("keeps %s, since the two do not conflict", (_, first, second) => {
    expect(cn(first, second)).toBe(`${first} ${second}`);
  });

  it.each([
    ["a type-scale size", "text-body", "text-answer"],
    ["a radius token", "rounded-card", "rounded-full"],
    ["a container token", "max-w-column", "max-w-none"],
    ["the glow", "shadow-glow", "shadow-none"],
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
    expect(className).toContain("border-input");
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
