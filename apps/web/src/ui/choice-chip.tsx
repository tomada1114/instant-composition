import type { ReactElement } from "react";

import { cn } from "../lib/utils";

import { CheckGlyph } from "./glyphs";

/**
 * `chip/choice`: a pressable pill on `raised`, selected as an ink border with
 * a check — never a colour. 36 tall, its hit area grown to 44.
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
        "relative flex h-9 items-center gap-1.5 rounded-full border-2 bg-raised px-3.5 text-label text-foreground",
        "before:absolute before:-inset-y-1.5 before:-inset-x-0.5 before:content-['']",
        selected ? "border-foreground" : "border-border enabled:hover:border-input",
        "disabled:text-disabled",
      )}
    >
      {selected ? <CheckGlyph className="-ml-1 size-4" /> : null}
      {label}
    </button>
  );
}
