import type { ReactElement } from "react";

import { cn } from "../lib/utils";

import { CheckGlyph } from "./glyphs";

/**
 * `chip/choice`: a pressable pill, selected as a white fill with a check —
 * never the accent. 36 tall, its hit area grown to 44.
 */
export function ChoiceChip({
  label,
  selected,
  disabled = false,
  onToggle,
}: Readonly<{
  label: string;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}>): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative flex h-9 items-center gap-1.5 rounded-full px-3.5 text-label",
        "before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
        selected ? "bg-primary text-primary-foreground" : "bg-card text-foreground",
        "disabled:text-disabled",
      )}
    >
      {selected ? <CheckGlyph className="-ml-1 size-4" /> : null}
      {label}
    </button>
  );
}
