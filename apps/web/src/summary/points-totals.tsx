import { useTranslations } from "use-intl";
import { useEffect, useRef, type ReactElement } from "react";

import { playMotion } from "../study/motion";

import type { RoundSummary } from "../openapi";
import type { Shown } from "./summary-parts";

/** This round's points and the running total; "+N pt" pops in on a live summary. */
export function PointsTotals({
  summary,
  shown,
  moving,
}: Readonly<{ summary: RoundSummary; shown: Shown; moving: boolean }>): ReactElement {
  const t = useTranslations("Summary");
  const { points } = summary;
  const chip = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (moving) playMotion(chip.current, "points");
  }, [moving]);
  return (
    <section className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center justify-between gap-3">
        {points.earned > 0 ? (
          <span
            ref={chip}
            className="inline-flex h-8 items-center rounded-full bg-energy px-3 font-latin text-count text-on-energy shadow-lip shadow-energy-lip"
          >
            {t("points.earned", { points: points.earned })}
          </span>
        ) : (
          <span />
        )}
        <span className="font-latin text-count text-muted-foreground">
          {t("points.total", { points: shown("points", points.total) })}
        </span>
      </p>
    </section>
  );
}

/** The running totals, with the last 14 days as bars. */
export function TotalsChart({
  summary,
  shown,
}: Readonly<{ summary: RoundSummary; shown: Shown }>): ReactElement {
  const t = useTranslations("Summary");
  const { totals } = summary;
  const most = Math.max(1, ...totals.last14.map((bar) => bar.count));
  return (
    <section className="flex flex-col gap-4">
      <p>
        {t("totals.line", {
          said: shown("said", totals.said),
          days: totals.practicedDays,
        })}
      </p>
      <div
        role="img"
        aria-label={t("totals.chart")}
        className="flex h-16 items-end gap-1.5"
      >
        {totals.last14.map((bar, index) => {
          const today = index === totals.last14.length - 1;
          const grown = today ? Math.min(bar.count, totals.added) : 0;
          return (
            <div
              key={bar.day}
              className="flex w-2.5 flex-col justify-end overflow-hidden rounded-full"
              style={{ height: `${String((bar.count / most) * 100)}%` }}
            >
              {grown > 0 ? (
                <div
                  className="bg-good-ink"
                  style={{ height: `${String((grown / bar.count) * 100)}%` }}
                />
              ) : null}
              <div className="flex-1 bg-muted-foreground" />
            </div>
          );
        })}
      </div>
    </section>
  );
}
