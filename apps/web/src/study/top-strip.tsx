import { useTranslations } from "use-intl";
import { useEffect, useRef, type ReactElement } from "react";

import { FocusStrip } from "../lib/frame";
import { BoltGlyph } from "../ui/filled-glyphs";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { playMotion } from "./motion";

/**
 * The drill's progress: an 18-tall `good` pill on the bar track, the share of
 * first passes already graded filled. The count beside it is what a screen
 * reader reads, so this is hidden.
 */
export function ProgressBar({
  filled,
  total,
}: Readonly<{ filled: number; total: number }>): ReactElement {
  const done = total > 0 ? Math.min(1, filled / total) : 0;
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
 * bar centred, and at the right the count of first passes, "again n" while
 * re-asks wait, and the combo from 2.
 */
export function TopStrip({
  current,
  total,
  filled,
  waiting,
  combo = 0,
  onPause,
}: Readonly<{
  /** The first pass on screen, or the last one shown during a re-ask, counted from 1. */
  current: number;
  total: number;
  /** First passes graded, the one being graded now included. */
  filled: number;
  /** Re-asks waiting, the one on screen not counted. */
  waiting: number;
  combo?: number;
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
      progress={<ProgressBar filled={filled} total={total} />}
      counters={
        <>
          <span className="font-latin text-count whitespace-nowrap text-muted-foreground">
            {t("progress", { current, total })}
          </span>
          {waiting > 0 ? (
            <span className="text-count whitespace-nowrap text-muted-foreground">
              {t("reAsks", { count: waiting })}
            </span>
          ) : null}
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
