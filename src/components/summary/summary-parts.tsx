import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactElement } from "react";

import { parseTitleKey } from "../../core/milestones";
import type { RoundSummary } from "../../core/views";
import { playMotion } from "@/components/drill/motion";
import { WeekRow } from "@/components/home/streak-figure";
import { cn } from "@/components/lib/utils";

/** A value as it stands now: counting up when this round changed it, final otherwise. */
export type Shown = (key: string, final: number) => number;

/** The run and the week; the figure and the day this round completed are lit. */
export function StreakBlock({
  summary,
  shown,
}: Readonly<{ summary: RoundSummary; shown: Shown }>): ReactElement {
  const t = useTranslations("Summary");
  const { streak } = summary;
  return (
    <section className="flex flex-col gap-5">
      {streak.restart ? (
        <p className="text-heading">{t("restartTitle")}</p>
      ) : (
        <p className="flex items-baseline gap-3">
          <span
            className={cn(
              "font-display text-number-lg",
              streak.changed && "text-accent",
            )}
          >
            {shown("streak", streak.value)}
          </span>
          <span className="text-label text-muted-foreground">{t("streakUnit")}</span>
        </p>
      )}
      <WeekRow dots={summary.week} lit={summary.filled} />
    </section>
  );
}

/** Where the difficulty moved: lit when up, muted when down, absent when still. */
export function DifficultyLine({
  change,
  toeic,
}: Readonly<{ change: "up" | "down" | null; toeic: string }>): ReactElement {
  const t = useTranslations("Summary.difficulty");
  return (
    <p
      className={cn(
        "flex gap-2",
        change === "down" ? "text-muted-foreground" : change === "up" && "text-accent",
      )}
    >
      <span>{t("line", { toeic })}</span>
      {change === null ? null : (
        <>
          <span aria-hidden>{change === "up" ? "↑" : "↓"}</span>
          <span className="sr-only">{t(change)}</span>
        </>
      )}
    </p>
  );
}

/** W9f's lead: where the first placement puts the difficulty. */
export function PlacementCard({ toeic }: Readonly<{ toeic: string }>): ReactElement {
  const t = useTranslations("Summary.placement");
  return (
    <section className="flex flex-col gap-2 rounded-card bg-card p-6">
      <p className="text-label text-muted-foreground">{t("title")}</p>
      <p className="text-heading">{t("start", { toeic })}</p>
    </section>
  );
}

/** The milestones this round reached, stacked, each 150 ms after the last. */
export function TitleCards({
  keys,
  topicNames,
  moving,
}: Readonly<{
  keys: readonly string[];
  topicNames: Readonly<Record<string, string>>;
  moving: boolean;
}>): ReactElement | null {
  const t = useTranslations("Summary.titles");
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moving || list.current === null) return;
    list.current
      .querySelectorAll<HTMLElement>("[data-title]")
      .forEach((card, index) => {
        playMotion(card, "title", index * 150);
      });
  }, [moving]);

  const titles = keys.flatMap((key) => {
    const title = parseTitleKey(key);
    if (title === undefined) return [];
    if (title.kind === "streak") {
      return [{ key, name: t("streak", { days: title.value }) }];
    }
    const topic = topicNames[title.topic] ?? title.topic;
    return [{ key, name: t("reach", { topic, count: title.value }) }];
  });
  if (titles.length === 0) return null;
  return (
    <div ref={list} className="flex flex-col gap-4">
      {titles.map((title) => (
        <section
          key={title.key}
          data-title
          className="flex flex-col gap-2 rounded-card border-[1.5px] border-accent bg-card p-5"
        >
          <p className="font-mono text-eyebrow text-muted-foreground uppercase">
            {t("label")}
          </p>
          <h3 className="text-heading">{title.name}</h3>
        </section>
      ))}
    </div>
  );
}

/** This round's points and the running totals, with the last 14 days as bars. */
export function PointsTotals({
  summary,
  shown,
}: Readonly<{ summary: RoundSummary; shown: Shown }>): ReactElement {
  const t = useTranslations("Summary");
  const { points, totals } = summary;
  const most = Math.max(1, ...totals.last14.map((bar) => bar.count));
  return (
    <section className="flex flex-col gap-4">
      <p className="flex items-baseline justify-between">
        {points.earned > 0 ? (
          <span className="font-display text-figure-sm text-accent">
            {t("points.earned", { points: points.earned })}
          </span>
        ) : (
          <span />
        )}
        <span className="font-mono text-mono-sm text-muted-foreground">
          {t("points.total", { points: shown("points", points.total) })}
        </span>
      </p>
      <p>
        {t("totals.line", {
          said: shown("said", totals.said),
          days: totals.practicedDays,
        })}
      </p>
      <div
        role="img"
        aria-label={t("totals.chart")}
        className="flex h-12 items-end gap-1.5"
      >
        {totals.last14.map((bar, index) => {
          const today = index === totals.last14.length - 1;
          const grown = today ? Math.min(bar.count, totals.added) : 0;
          return (
            <div
              key={bar.day}
              className="flex w-2 flex-col justify-end overflow-hidden rounded-full"
              style={{ height: `${String((bar.count / most) * 100)}%` }}
            >
              {grown > 0 ? (
                <div
                  className="bg-accent"
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
