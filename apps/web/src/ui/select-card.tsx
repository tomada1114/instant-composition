import type { ReactElement } from "react";

import { cn } from "../lib/utils";

import { CheckGlyph } from "./glyphs";

/**
 * `designing-ui`'s `select-card`: a toggle whose state shows as a white
 * border and a filled check — never the accent, never color alone. `locked`
 * keeps a selected card looking selected while refusing to turn it off.
 * `compact` is the two-across card: shorter, its title in `label`.
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
        "flex w-full items-center rounded-tile border-[1.5px] bg-card text-left",
        compact ? "h-full min-h-16 gap-3 px-4 py-3" : "min-h-18 gap-4 px-5 py-3.5",
        selected ? "border-foreground" : "border-transparent active:bg-raised",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={compact ? "text-label" : "text-action"}>{title}</span>
        <span className="truncate text-caption text-muted-foreground">{detail}</span>
      </span>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          selected
            ? "bg-primary text-primary-foreground"
            : "border-[1.5px] border-border",
        )}
      >
        {selected ? <CheckGlyph className="size-4" /> : null}
      </span>
    </button>
  );
}
