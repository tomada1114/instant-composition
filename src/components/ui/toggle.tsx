import type { ReactElement } from "react";

import { cn } from "@/components/lib/utils";

/**
 * `toggle`: on is a white track with a black knob, off a raised track with a
 * border and a grey knob; the words for the state sit to its right.
 */
export function Toggle({
  labelledBy,
  on,
  words,
  onChange,
}: Readonly<{
  labelledBy: string;
  on: boolean;
  words: string;
  onChange: (on: boolean) => void;
}>): ReactElement {
  return (
    <span className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelledBy}
        onClick={() => {
          onChange(!on);
        }}
        className={cn(
          "relative h-7 w-12 rounded-full border-[1.5px] transition-colors",
          on ? "border-primary bg-primary" : "border-input bg-raised",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-[left]",
            on
              ? "left-[calc(100%-1.375rem)] bg-primary-foreground"
              : "left-0.5 bg-muted-foreground",
          )}
        />
      </button>
      <span aria-hidden className="text-label">
        {words}
      </span>
    </span>
  );
}
