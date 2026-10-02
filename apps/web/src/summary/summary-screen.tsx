import { useEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import { prefersReducedMotion } from "../drill/motion";
import { FocusStrip } from "../lib/frame";
import { usePrimaryKey } from "../lib/use-primary-key";
import { cn } from "../lib/utils";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import type { RoundKind, RoundSummary } from "../openapi";
import { countUpPlan, useElapsed, valueAt } from "./count-up";
import { GrowthSection, ReviewSection } from "./growth-section";
import { ReachRings } from "./reach-rings";
import {
  DifficultyLine,
  PlacementCard,
  StreakBlock,
  TitleCards,
} from "./summary-parts";
import { PointsTotals, TotalsChart } from "./points-totals";
import { SummaryActions } from "./summary-actions";

/** One card of the summary's grid, spanning `span` of its 12 columns from `pc`. */
function Panel({
  span,
  children,
}: Readonly<{ span: string; children: ReactNode }>): ReactElement {
  return (
    <div className={cn("rounded-panel border-2 border-border bg-card p-6", span)}>
      {children}
    </div>
  );
}

/**
 * W9 and its kin, at most 1120: the hero centred — the title, the streak,
 * the week and the actions, inside the first view — then milestones, the
 * cards on the grid and the difficulty line; one column below `pc`. `live` is the round
 * just finished — changed values count up and the buttons close it;
 * `recap` (W9r) re-reads today's last summary with every value final, and
 * Esc goes back. Either way the focus strip's ✕ (`onEnd`) closes it.
 */
export function SummaryScreen({
  summary,
  mode,
  dailySize,
  onNext,
  onEnd,
}: Readonly<{
  summary: RoundSummary;
  mode: "live" | "recap";
  dailySize: number;
  onNext: (kind: RoundKind) => void;
  onEnd: () => void;
}>): ReactElement {
  const t = useTranslations("Summary");
  const heading = useRef<HTMLHeadingElement>(null);
  const live = mode === "live";
  const [plan, moving] = useMemo(
    () => [countUpPlan(summary), live && !prefersReducedMotion()],
    [summary, live],
  );
  const elapsed = useElapsed(plan, moving);
  usePrimaryKey();

  function shown(key: string, final: number): number {
    const entry = plan.find((candidate) => candidate.key === key);
    return entry === undefined ? final : valueAt(entry, elapsed);
  }

  const end = useRef(onEnd);
  useEffect(() => {
    end.current = onEnd;
  });

  useEffect(() => {
    if (live) {
      heading.current?.focus();
      return undefined;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") end.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [live]);

  const title = live
    ? summary.yesterday
      ? t("title.yesterday")
      : t("title.today")
    : t("title.recap");
  const placement = summary.placement;

  return (
    <div className="mx-auto flex w-full max-w-dashboard flex-col gap-8 py-8">
      <FocusStrip
        close={
          <IconButton plain type="button" aria-label={t("close")} onClick={onEnd}>
            <CloseGlyph />
          </IconButton>
        }
      />
      <header className="flex flex-col items-center gap-6 text-center">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-heading focus-visible:outline-none"
        >
          {title}
        </h1>
        <StreakBlock summary={summary} shown={shown} />
        {live ? (
          <SummaryActions
            summary={summary}
            dailySize={dailySize}
            onNext={onNext}
            onEnd={onEnd}
          />
        ) : null}
      </header>
      {placement?.first === true ? <PlacementCard toeic={placement.toeic} /> : null}
      <TitleCards
        keys={summary.titles}
        topicNames={summary.topicNames}
        moving={moving}
      />
      <div className="grid gap-6 pc:grid-cols-12">
        <Panel span="pc:col-span-4">
          <GrowthSection growth={summary.growth} shown={shown} />
        </Panel>
        <Panel span="pc:col-span-4">
          <ReachRings reach={summary.reach} shown={shown} />
        </Panel>
        <Panel span="pc:col-span-4">
          <PointsTotals summary={summary} shown={shown} />
        </Panel>
        <Panel span="pc:col-span-7">
          <ReviewSection rows={summary.review} shown={shown} />
        </Panel>
        <Panel span="pc:col-span-5">
          <TotalsChart summary={summary} shown={shown} />
        </Panel>
      </div>
      {summary.difficulty !== null ? (
        <DifficultyLine
          change={summary.difficulty.change}
          toeic={summary.difficulty.toeic}
        />
      ) : placement !== null && !placement.first ? (
        <DifficultyLine change={null} toeic={placement.toeic} />
      ) : null}
    </div>
  );
}
