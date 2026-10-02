import type { ReactElement } from "react";

import { cn } from "../lib/utils";

/**
 * A key hint pinned to one edge of the control it sits in: a pill whose
 * border is the control's own text color at 45%, around the key at full
 * strength, so the key measures as the control's label does. Hidden until the
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
        "pointer-events-none absolute hidden h-5 items-center rounded-full border-[1.5px] border-current/45 px-1.5 font-latin text-eyebrow tracking-normal keys:inline-flex",
        side === "end" ? "right-3.5" : "left-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}
