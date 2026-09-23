import type { ReactElement } from "react";

import { cn } from "@/components/lib/utils";

import { CheckGlyph } from "./glyphs";

/**
 * `chip/choice`: a pressable pill, selected with a white border and a check
 * rather than a color. 36 tall, its hit area grown to 44.
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
        "relative flex h-9 items-center gap-1.5 rounded-full border-[1.5px] bg-raised px-3 text-label",
        "before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
        selected ? "border-foreground" : "border-transparent",
        "disabled:text-disabled",
      )}
    >
      {label}
      {selected ? (
        <span aria-hidden className="-mr-1 [&_svg]:size-4">
          <CheckGlyph />
        </span>
      ) : null}
    </button>
  );
}
