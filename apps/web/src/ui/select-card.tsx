import type { ReactElement } from "react";

import { cn } from "../lib/utils";

import { CheckGlyph } from "./glyphs";

/**
 * `designing-ui`'s `select-card`: a toggle standing on a lip, whose state
 * shows as an ink border and lip and a filled check — never a colour, never
 * color alone. Pressed, it drops onto its lip. `locked` keeps a selected card
 * looking selected while refusing to turn it off, so it neither sinks nor
 * takes the hover fill. `compact` is the two-across card: shorter, its title
 * in `label`.
 */
export function SelectCard({
  title,
  detail,
  selected,
  locked = false,
  compact = false,
  onToggle,
}: Readonly<{
  title: string;
  detail: string;
  selected: boolean;
  locked?: boolean;
  compact?: boolean;
  onToggle: () => void;
}>): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-disabled={locked || undefined}
      onClick={onToggle}
      className={cn(
        "mb-1 flex w-full items-center rounded-control border-2 bg-card text-left shadow-lip transition-[translate,box-shadow] duration-60",
        compact ? "h-full min-h-16 gap-3 px-4 py-3" : "min-h-18 gap-4 px-5 py-3.5",
        selected ? "border-foreground shadow-foreground" : "border-input shadow-input",
        !locked && "hover:bg-raised active:translate-y-1 active:shadow-none",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={compact ? "text-label" : "text-action"}>{title}</span>
        <span className="truncate text-caption text-muted-foreground">{detail}</span>
      </span>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          selected ? "bg-primary text-primary-foreground" : "border-2 border-input",
        )}
      >
        {selected ? <CheckGlyph className="size-4" /> : null}
      </span>
    </button>
  );
}
