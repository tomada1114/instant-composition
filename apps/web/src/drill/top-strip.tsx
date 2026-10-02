import { useTranslations } from "use-intl";
import { useEffect, useRef, type ReactElement } from "react";

import { FocusStrip } from "../lib/frame";
import type { Pass } from "../openapi";
import { BoltGlyph } from "../ui/filled-glyphs";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { playMotion } from "./motion";

/**
 * The drill's progress: an 18-tall `good` pill on the bar track, the share of
 * the pass already graded filled — lit the moment the current card is said.
 * The count beside it is what a screen reader reads, so this is hidden.
 */
export function ProgressBar({
  current,
  total,
  lit,
}: Readonly<{ current: number; total: number; lit: boolean }>): ReactElement {
  const done = total > 0 ? Math.min(1, (current - (lit ? 0 : 1)) / total) : 0;
  return (
    <div
      aria-hidden
      className="mx-auto h-4.5 w-full max-w-progress overflow-hidden rounded-full bg-bar-track"
    >
      <div
        data-part="progress-fill"
        className="h-full rounded-full bg-good transition-[width] duration-160"
        style={{ width: `${String(Math.max(0, done) * 100)}%` }}
      />
    </div>
  );
}

/**
 * The drill's focus strip: ✕, which pauses (as Esc and `?` do), the progress
 * bar centred, and the count with the combo from 2 at the right.
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
      progress={<ProgressBar current={current} total={total} lit={lit} />}
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
              className="mb-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-energy px-3 font-latin text-count whitespace-nowrap text-on-energy shadow-lip shadow-energy-lip"
            >
              <BoltGlyph className="size-4" />
              <span>{combo}</span>
              {t("comboLabel")}
            </span>
          ) : null}
        </>
      }
    />
  );
}
