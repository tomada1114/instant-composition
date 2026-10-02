import { useRef, type KeyboardEvent, type ReactElement } from "react";

import { cn } from "../lib/utils";

/**
 * `segmented`: one choice of a few, the chosen segment a `surface` face in an
 * ink border on the raised track; under the pointer the others take the face. `columns` wraps more options than a phone's width holds into rows
 * of that many; `value` null leaves every segment unchosen. `disabled`
 * shows the value without offering the others: the chosen segment keeps its
 * fill, the rest turn `text-disabled`, and none of them responds.
 *
 * Keys follow the WAI-ARIA radio group: only the chosen segment (the first
 * when none is) sits in the tab order, and the arrows, Home and End move
 * focus and the choice together, wrapping at either end.
 */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  columns,
  disabled = false,
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
  disabled?: boolean;
}>): ReactElement {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = options.findIndex((option) => option.value === value);
  const tabStop = checked === -1 ? 0 : checked;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = options.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    // Handled here alone: no window listener or page scroll sees the key.
    event.preventDefault();
    event.stopPropagation();
    const option = options[next];
    if (option === undefined) return;
    buttons.current[next]?.focus();
    if (option.value !== value) onChange(option.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        "rounded-control bg-raised p-1",
        columns === undefined ? "flex" : "grid gap-y-1",
      )}
      style={
        columns === undefined
          ? undefined
          : { gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }
      }
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          tabIndex={index === tabStop ? 0 : -1}
          onKeyDown={(event) => {
            onKeyDown(event, index);
          }}
          type="button"
          disabled={disabled}
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            "h-11 flex-1 rounded-control border-2 font-display text-action",
            option.value === value
              ? "border-foreground bg-card text-foreground"
              : disabled
                ? "border-transparent text-disabled"
                : "border-transparent text-foreground hover:bg-card",
          )}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}
