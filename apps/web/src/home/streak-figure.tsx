import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { cn } from "../lib/utils";
import type { Dot, StreakView } from "../openapi";
import { FlameGlyph } from "../ui/filled-glyphs";
import { CheckGlyph } from "../ui/glyphs";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** The run as the streak tile's figure beside a flame, or "day 1 from today" with the longest run after a break: never a 0. */
export function StreakFigure({
  streak,
}: Readonly<{ streak: StreakView }>): ReactElement {
  const t = useTranslations("Home");
  if (streak.kind === "restart") {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-heading">{t("restartTitle")}</h2>
        <p className="font-latin text-count text-muted-foreground">
          {t("longest", { days: streak.longest })}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-3">
        <span className="flex items-center gap-2">
          <span className="font-display text-number-lg">{streak.value}</span>
          <FlameGlyph className="size-9 text-energy" />
        </span>
        <span className="text-label text-muted-foreground">{t("streakUnit")}</span>
      </h2>
      {streak.yesterdayGap ? <p>{t("yesterdayGap")}</p> : null}
    </div>
  );
}

type DiscState = Dot["state"] | "today";

const DISC: Readonly<Record<DiscState, string>> = {
  done: "bg-energy text-on-energy",
  today: "border-3 border-foreground",
  gap: "border-2 border-input",
  missed: "bg-raised",
  upcoming: "border-2 border-dashed border-input",
};

/**
 * `week-row`: Monday to Sunday as seven 32 discs, each over its weekday —
 * done (an `energy` disc with a check), today not yet done (an ink ring),
 * open (a solid ring, can still be made up), missed (a `raised` disc), ahead
 * (a dashed ring). The API sends today undone as `upcoming`, like the days
 * ahead and the days before the first practice, so with `findToday` it is
 * the dot after the last past state (done, open, missed) — and none when
 * every dot is `upcoming`, which cannot tell today apart. A tile narrower than the row's 272 shrinks the discs
 * rather than overflowing. `lit` is a day a round just completed, drawn done.
 */
export function WeekRow({
  dots,
  findToday = false,
  lit = null,
}: Readonly<{
  dots: readonly Dot[];
  findToday?: boolean;
  lit?: string | null;
}>): ReactElement {
  const t = useTranslations("Home.week");
  const past = dots.findLastIndex((dot) => dot.state !== "upcoming");
  const today = findToday && past >= 0 ? dots[past + 1]?.day : undefined;
  return (
    <ol className="flex w-full max-w-68 gap-2">
      {dots.map((dot, index) => {
        const state: DiscState =
          dot.day === lit ? "done" : dot.day === today ? "today" : dot.state;
        return (
          <li
            key={dot.day}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            <span className="text-caption text-muted-foreground">
              {t(WEEKDAYS[index] ?? "sun")}
            </span>
            <span
              data-state={state}
              className={cn(
                "flex aspect-square w-full max-w-8 items-center justify-center rounded-full",
                DISC[state],
              )}
            >
              {state === "done" ? <CheckGlyph className="size-4" /> : null}
            </span>
            <span className="sr-only">{t(state)}</span>
          </li>
        );
      })}
    </ol>
  );
}
