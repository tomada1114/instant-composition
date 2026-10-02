import { useTranslations } from "use-intl";
import { useEffect, useRef, type ReactElement } from "react";

import { FocusStrip } from "../lib/frame";
import { cn } from "../lib/utils";
import type { Pass } from "../openapi";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { playMotion } from "./motion";

/** Past this many cards a tick would be thinner than it is tall, so the ticks give way to the count alone. */
const MAX_TICKS = 30;

/**
 * One tick per card of the pass: done in ink, the current one dimmed —
 * lit `good` the moment it is said — and the rest grooves. The talk
 * screen draws one per turn the same way.
 */
export function Ticks({
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
                    ? "bg-good"
                    : "bg-muted-foreground"
                  : "bg-border",
            )}
          />
        );
      })}
    </div>
  );
}

/**
 * The drill's focus strip: ✕, which pauses (as Esc and `?` do), the ticks
 * centred, and the count with the combo from 2 at the right.
 */
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
    <FocusStrip
      close={
        <IconButton plain type="button" aria-label={t("pause")} onClick={onPause}>
          <CloseGlyph />
        </IconButton>
      }
      progress={<Ticks current={current} total={total} lit={lit} />}
      counters={
        <>
          <span className="font-latin text-count whitespace-nowrap text-muted-foreground">
            {pass === "first"
              ? t("progress", { current, total })
              : t("retryProgress", { current, total })}
          </span>
          {combo >= 2 ? (
            <span
              ref={comboRef}
              data-part="combo"
              className="inline-flex items-baseline gap-1.5 rounded-full bg-energy px-3 py-0.5 font-latin text-count whitespace-nowrap text-on-energy"
            >
              <span className="font-display text-figure-sm">{combo}</span>
              {t("comboLabel")}
            </span>
          ) : null}
        </>
      }
    />
  );
}
