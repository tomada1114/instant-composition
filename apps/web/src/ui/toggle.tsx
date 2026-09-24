import type { ReactElement } from "react";

import { cn } from "../lib/utils";

/**
 * `toggle`: on is a white track with a black knob at the right, off a raised
 * track with a grey knob at the left — position and fill, never color alone.
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
        "relative h-8 w-13 shrink-0 rounded-full transition-colors",
        on ? "bg-primary" : "bg-raised",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 size-6 -translate-y-1/2 rounded-full transition-[left]",
          on
            ? "left-[calc(100%-1.75rem)] bg-primary-foreground"
            : "left-1 bg-muted-foreground",
        )}
      />
    </button>
  );
}
