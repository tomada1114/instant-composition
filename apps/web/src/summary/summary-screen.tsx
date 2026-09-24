import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { prefersReducedMotion } from "../drill/motion";
import { usePrimaryKey } from "../lib/use-primary-key";
import { Button } from "../ui/button";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import type { RoundKind, RoundSummary } from "../openapi";
import { PrimaryButton } from "../ui/primary-button";
import { countUpPlan, useElapsed, valueAt } from "./count-up";
import { GrowthSection, ReviewSection } from "./growth-section";
import { ReachRings } from "./reach-rings";
import {
  DifficultyLine,
  PlacementCard,
  PointsTotals,
  StreakBlock,
  TitleCards,
} from "./summary-parts";

/**
 * W9: what the round just finished moved, top to bottom — changed values
 * count up, and the buttons close it. W9r, re-reading today's last summary
 * with every value final, is the recap screen's, which is still to be ported
 * (#43).
 */
export function SummaryScreen({
  summary,
  dailySize,
  onNext,
  onEnd,
}: Readonly<{
  summary: RoundSummary;
  dailySize: number;
  onNext: (kind: RoundKind) => void;
  onEnd: () => void;
}>): ReactElement {
  const t = useTranslations("Summary");
  const heading = useRef<HTMLHeadingElement>(null);
  const [plan, moving] = useMemo(
    () => [countUpPlan(summary), !prefersReducedMotion()],
    [summary],
  );
  const elapsed = useElapsed(plan, moving);
  usePrimaryKey();

  function shown(key: string, final: number): number {
    const entry = plan.find((candidate) => candidate.key === key);
    return entry === undefined ? final : valueAt(entry, elapsed);
  }

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const title = summary.yesterday ? t("title.yesterday") : t("title.today");
  const placement = summary.placement;

  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-1rem)] max-w-column flex-col px-4 pt-4">
      <header className="flex flex-col gap-6">
        <div className="flex h-11 items-center justify-between">
          <span />
          <IconButton type="button" aria-label={t("close")} onClick={onEnd}>
            <CloseGlyph />
          </IconButton>
        </div>
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-heading focus-visible:outline-none"
        >
          {title}
        </h1>
      </header>
      <div className="mt-4 flex flex-col divide-y divide-border *:py-8">
        {placement?.first === true ? <PlacementCard toeic={placement.toeic} /> : null}
        <GrowthSection growth={summary.growth} shown={shown} />
        <ReviewSection rows={summary.review} shown={shown} />
        <StreakBlock summary={summary} shown={shown} />
        {summary.difficulty !== null ? (
          <DifficultyLine
            change={summary.difficulty.change}
            toeic={summary.difficulty.toeic}
          />
        ) : placement !== null && !placement.first ? (
          <DifficultyLine change={null} toeic={placement.toeic} />
        ) : null}
        <ReachRings reach={summary.reach} shown={shown} />
        <TitleCards
          keys={summary.titles}
          topicNames={summary.topicNames}
          moving={moving}
        />
        <PointsTotals summary={summary} shown={shown} />
      </div>
      <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2.5 bg-background px-4 pt-3 pb-3">
        {summary.yesterday ? (
          summary.todayOpen ? (
            <>
              <Button variant="secondary" onClick={onEnd}>
                {t("actions.end")}
              </Button>
              <PrimaryButton
                onPress={() => {
                  onNext("today");
                }}
              >
                {t("actions.today")}
              </PrimaryButton>
            </>
          ) : (
            <PrimaryButton onPress={onEnd}>{t("actions.end")}</PrimaryButton>
          )
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                onNext("extra");
              }}
            >
              {t("actions.more", { count: dailySize })}
            </Button>
            <PrimaryButton onPress={onEnd}>{t("actions.end")}</PrimaryButton>
          </>
        )}
      </footer>
    </main>
  );
}
