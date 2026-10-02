import type { ReactElement } from "react";

import { cn } from "../lib/utils";

/**
 * `toggle`: on is an ink track with a `surface` knob at the right, off a
 * raised track in a control border with a control-border knob at the left —
 * position and fill, never color alone. Under the pointer the track steps
 * once: off to `border`, on to `ink-2`.
 */
export function Toggle({
  labelledBy,
  on,
  onChange,
}: Readonly<{
  labelledBy: string;
  on: boolean;
  onChange: (on: boolean) => void;
}>): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      onClick={() => {
        onChange(!on);
      }}
      className={cn(
        "relative h-8 w-13 shrink-0 rounded-full border-2",
        // The track is 32 tall; the overlay makes the hit area 44 × 44 or more.
        "before:absolute before:-inset-y-2 before:-inset-x-0.5 before:content-['']",
        on
          ? "border-foreground bg-foreground hover:border-muted-foreground hover:bg-muted-foreground"
          : "border-input bg-raised hover:bg-border",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-[left]",
          on ? "left-[calc(100%-1.5rem)] bg-card" : "left-1 bg-input",
        )}
      />
    </button>
  );
}
