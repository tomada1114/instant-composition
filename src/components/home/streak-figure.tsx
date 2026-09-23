import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import type { StreakView } from "../../core/home-state";
import type { Dot } from "../../core/streak";
import { cn } from "@/components/lib/utils";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** The run as the screen's one big figure, or "day 1 from today" with the longest run after a break: never a 0. */
export function StreakFigure({
  streak,
}: Readonly<{ streak: StreakView }>): ReactElement {
  const t = useTranslations("Home");
  if (streak.kind === "restart") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-heading">{t("restartTitle")}</h1>
        <p className="font-mono text-mono-sm text-muted-foreground">
          {t("longest", { days: streak.longest })}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-baseline gap-3">
        <span className="font-display text-number-xl">{streak.value}</span>
        <span className="text-label text-muted-foreground">{t("streakUnit")}</span>
      </h1>
      {streak.yesterdayGap ? <p>{t("yesterdayGap")}</p> : null}
    </div>
  );
}

const BAR: Readonly<Record<Dot["state"], string>> = {
  done: "bg-foreground",
  gap: "border-[1.5px] border-foreground",
  missed: "bg-border",
  upcoming: "border border-dashed border-border",
};

/**
 * Monday to Sunday as seven bars, each over its weekday: filled (done),
 * outlined in white (open, can still be made up), dark (missed), dashed
 * (upcoming). `lit` is the day a round just completed, filled with the accent.
 */
export function WeekRow({
  dots,
  lit = null,
}: Readonly<{ dots: readonly Dot[]; lit?: string | null }>): ReactElement {
  const t = useTranslations("Home.week");
  return (
    <ol className="flex gap-1.5">
      {dots.map((dot, index) => (
        <li key={dot.day} className="flex flex-1 flex-col items-center gap-2">
          <span
            data-state={dot.state}
            className={cn(
              "h-9 w-full rounded-bar",
              dot.day === lit ? "bg-accent" : BAR[dot.state],
            )}
          />
          <span className="text-caption text-muted-foreground">
            {t(WEEKDAYS[index] ?? "sun")}
          </span>
          <span className="sr-only">{t(dot.state)}</span>
        </li>
      ))}
    </ol>
  );
}
