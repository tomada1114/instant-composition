import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import type { StreakView } from "../../core/home-state";
import type { Dot } from "../../core/streak";
import { cn } from "@/components/lib/utils";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** The run above the week, or "day 1 from today" with the longest run after a break: never a 0. */
export function StreakFigure({
  streak,
}: Readonly<{ streak: StreakView }>): ReactElement {
  const t = useTranslations("Home");
  if (streak.kind === "restart") {
    return (
      <div className="flex flex-col gap-1">
        <h1>{t("restartTitle")}</h1>
        <p className="text-caption text-muted-foreground">
          {t("longest", { days: streak.longest })}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <h1 className="flex flex-col">
        <span className="font-latin text-number-lg">{streak.value}</span>
        <span className="text-label">{t("streakUnit")}</span>
      </h1>
      {streak.yesterdayGap ? <p>{t("yesterdayGap")}</p> : null}
    </div>
  );
}

const DOT: Readonly<Record<Dot["state"], string>> = {
  done: "bg-foreground",
  gap: "border-[1.5px] border-foreground",
  missed: "bg-border",
  upcoming: "border border-border",
};

/** Monday to Sunday: each dot over its weekday, an open day marked "open" in words too. */
export function WeekRow({ dots }: Readonly<{ dots: readonly Dot[] }>): ReactElement {
  const t = useTranslations("Home.week");
  return (
    <ol className="flex gap-4">
      {dots.map((dot, index) => (
        <li key={dot.day} className="flex w-3 flex-col items-center gap-1.5">
          <span className={cn("size-3 rounded-full", DOT[dot.state])} />
          <span className="text-caption text-muted-foreground">
            {t(WEEKDAYS[index] ?? "sun")}
          </span>
          {dot.state === "gap" ? (
            <span className="text-caption text-muted-foreground">{t("gap")}</span>
          ) : (
            <span className="sr-only">{t(dot.state)}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
