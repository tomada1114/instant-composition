import type { ReactElement } from "react";

import { cn } from "../lib/utils";

/**
 * A key hint pinned to one edge of the control it sits in. Hidden until the
 * learner has used the keyboard (the `keys` variant in `globals.css`), and
 * hidden from assistive technology — the control already carries the name.
 * The control must be `relative`; `Button` is.
 */
export function Kbd({
  children,
  side = "end",
  className,
}: Readonly<{
  children: string;
  /** Which edge it is pinned to: a "←" hint sits at the start, so it points the way it is pressed. */
  side?: "start" | "end";
  className?: string;
}>): ReactElement {
  return (
    <span
      aria-hidden
      data-slot="kbd"
      className={cn(
        "pointer-events-none absolute hidden h-5 items-center rounded-full border border-current px-1.5 font-mono text-eyebrow tracking-normal opacity-45 keys:inline-flex",
        side === "end" ? "right-3.5" : "left-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}
