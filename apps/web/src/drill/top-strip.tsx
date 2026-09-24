import { useTranslations } from "use-intl";
import { useEffect, useRef, type ReactElement } from "react";

import { cn } from "../lib/utils";
import type { Pass } from "../openapi";
import { PauseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { playMotion } from "./motion";

/** Past this many cards a tick would be thinner than it is tall, so the ticks give way to the count alone. */
const MAX_TICKS = 30;

/**
 * One tick per card of the pass: done in white, the current one dimmed —
 * lit with the accent the moment it is said — and the rest grooves.
 */
function Ticks({
  current,
  total,
  lit,
}: Readonly<{ current: number; total: number; lit: boolean }>): ReactElement | null {
  if (total > MAX_TICKS) return null;
  return (
    <div aria-hidden className="flex gap-1">
      {Array.from({ length: total }, (_, index) => {
        const position = index + 1;
        return (
          <span
            key={position}
            className={cn(
              "h-0.75 flex-1 rounded-full transition-colors duration-160",
              position < current
                ? "bg-foreground"
                : position === current
                  ? lit
                    ? "bg-accent"
                    : "bg-muted-foreground"
                  : "bg-border",
            )}
          />
        );
      })}
    </div>
  );
}

/** The ticks across the top; under them pause, the count, and the combo from 2. */
export function TopStrip({
  pass,
  current,
  total,
  combo,
  lit,
  onPause,
}: Readonly<{
  pass: Pass;
  current: number;
  total: number;
  combo: number;
  lit: boolean;
  onPause: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.card");
  const comboRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (combo >= 2) playMotion(comboRef.current, "pulse");
  }, [combo]);

  return (
    <div className="flex flex-col gap-2">
      <Ticks current={current} total={total} lit={lit} />
      <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center">
        <IconButton
          plain
          type="button"
          aria-label={t("pause")}
          onClick={onPause}
          className="justify-self-start"
        >
          <PauseGlyph />
        </IconButton>
        <span className="font-mono text-mono-sm text-muted-foreground">
          {pass === "first"
            ? t("progress", { current, total })
            : t("retryProgress", { current, total })}
        </span>
        <span className="justify-self-end text-accent">
          {combo >= 2 ? (
            <span
              ref={comboRef}
              data-part="combo"
              className="inline-flex items-baseline gap-1.5 font-mono text-mono-sm"
            >
              <span className="font-display text-figure-sm">{combo}</span>
              {t("comboLabel")}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
