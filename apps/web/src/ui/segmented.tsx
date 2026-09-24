import type { ReactElement } from "react";

import { cn } from "../lib/utils";

/** `segmented`: one choice of a few, the chosen segment white on the raised track. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: Readonly<{
  label: string;
  options: readonly {
    readonly value: T;
    readonly label: string;
    readonly text: string;
  }[];
  value: T;
  onChange: (value: T) => void;
}>): ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-control bg-card p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            "h-11 flex-1 rounded-tile font-display text-action",
            option.value === value
              ? "bg-primary text-primary-foreground"
              : "text-foreground",
          )}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}
