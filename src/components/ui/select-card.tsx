import type { ReactElement } from "react";

import { cn } from "@/components/lib/utils";

import { CheckGlyph } from "./glyphs";

/**
 * `designing-ui`'s `select-card`: a toggle whose state shows as a raised
 * fill, a white border and a check — never the accent, never color alone.
 */
export function SelectCard({
  title,
  detail,
  selected,
  disabled = false,
  onToggle,
}: Readonly<{
  title: string;
  detail: string;
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
        "flex min-h-16 w-full items-center gap-4 rounded-tile border-[1.5px] px-4 py-3 text-left",
        selected ? "border-foreground bg-raised" : "border-transparent bg-card",
        "disabled:text-disabled",
      )}
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-action">{title}</span>
        <span className="text-caption text-muted-foreground">{detail}</span>
      </span>
      <span className={cn("shrink-0", selected ? "text-foreground" : "invisible")}>
        <CheckGlyph />
      </span>
    </button>
  );
}
