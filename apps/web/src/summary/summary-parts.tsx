import { useTranslations } from "use-intl";
import { useEffect, useRef, type ReactElement, type RefObject } from "react";

import { playMotion } from "../drill/motion";
import { WeekRow } from "../home/streak-figure";
import { cn } from "../lib/utils";
import { FlameGlyph } from "../ui/filled-glyphs";
import type { RoundSummary } from "../openapi";
import { parseTitleKey } from "./titles";

/** A value as it stands now: counting up when this round changed it, final otherwise. */
export type Shown = (key: string, final: number) => number;

/**
 * The run and the week, centred in the hero; the figure and the day this
 * round completed are lit — `stat/xl` beside a flame when the run grew.
 */
export function StreakBlock({
  summary,
  shown,
  figure,
  celebrate,
}: Readonly<{
  summary: RoundSummary;
  shown: Shown;
  figure: RefObject<HTMLParagraphElement | null>;
  celebrate: boolean;
}>): ReactElement {
  const t = useTranslations("Summary");
  const { streak } = summary;
  const flame = useRef<HTMLSpanElement>(null);
  const number = useRef<HTMLSpanElement>(null);
  const week = useRef<HTMLDivElement>(null);
  const today = summary.week.findIndex((dot) => dot.day === summary.filled);

  useEffect(() => {
    if (!celebrate) return;
    playMotion(number.current, "pop");
    playMotion(flame.current, "flame");
    playMotion(week.current?.querySelectorAll("[data-state]")[today] ?? null, "check");
  }, [celebrate, today]);

  return (
    <section className="flex w-full flex-col items-center gap-5">
      {streak.restart ? (
        <p ref={figure} className="text-heading">
          {t("restartTitle")}
        </p>
      ) : (
        <p ref={figure} className="flex items-center gap-3">
          {streak.changed ? (
            <span ref={flame} className="inline-flex">
              <FlameGlyph className="size-12 text-energy" />
            </span>
          ) : null}
          <span
            ref={number}
            className={cn(
              "font-display",
              streak.changed
                ? "text-number-xl text-energy [paint-order:stroke_fill] [text-shadow:0_0.5rem_0_var(--on-energy)] [-webkit-text-stroke:0.375rem_var(--on-energy)]"
                : "text-number-lg",
            )}
          >
            {shown("streak", streak.value)}
          </span>
          <span className="text-label text-muted-foreground">{t("streakUnit")}</span>
        </p>
      )}
      <div ref={week} className="w-full max-w-sm">
        <WeekRow dots={summary.week} lit={summary.filled} />
      </div>
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
        change === "down"
          ? "text-muted-foreground"
          : change === "up" && "text-good-ink",
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
          className="flex flex-col gap-2 rounded-card border-2 border-energy bg-card p-5"
        >
          <p className="font-latin text-eyebrow text-muted-foreground uppercase">
            {t("label")}
          </p>
          <h3 className="text-heading">{title.name}</h3>
        </section>
      ))}
    </div>
  );
}
