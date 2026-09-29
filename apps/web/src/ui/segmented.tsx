import type { ReactElement } from "react";

import { cn } from "../lib/utils";

/**
 * `segmented`: one choice of a few, the chosen segment white on the raised
 * track. `columns` wraps more options than a phone's width holds into rows
 * of that many; `value` null leaves every segment unchosen.
 */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  columns,
}: Readonly<{
  label: string;
  options: readonly {
    readonly value: T;
    readonly label: string;
    readonly text: string;
  }[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: number;
}>): ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "rounded-control bg-card p-1",
        columns === undefined ? "flex" : "grid gap-y-1",
      )}
      style={
        columns === undefined
          ? undefined
          : { gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }
      }
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
