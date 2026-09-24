import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { prefersReducedMotion } from "../drill/motion";
import { usePrimaryKey } from "../lib/use-primary-key";
import { Button } from "../ui/button";
import { BackGlyph, CloseGlyph } from "../ui/glyphs";
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
 * W9 and its kin: what a round moved, top to bottom. `live` is the round
 * just finished — changed values count up and the buttons close it;
 * `recap` (W9r) re-reads today's last summary with every value final, and
 * ← and Esc (`onEnd`) go back.
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
    <main className="mx-auto box-content flex min-h-[calc(100dvh-1rem)] max-w-column flex-col px-4 pt-4">
      <header className="flex flex-col gap-6">
        <div className="flex h-11 items-center justify-between">
          {live ? (
            <>
              <span />
              <IconButton type="button" aria-label={t("close")} onClick={onEnd}>
                <CloseGlyph />
              </IconButton>
            </>
          ) : (
            <IconButton asChild>
              <Link to="/" aria-label={t("back")}>
                <BackGlyph />
              </Link>
            </IconButton>
          )}
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
      {live ? (
        <SummaryActions
          summary={summary}
          dailySize={dailySize}
          onNext={onNext}
          onEnd={onEnd}
        />
      ) : null}
    </main>
  );
}

/** The buttons under a live summary: one more round, today's portion, or the end. */
function SummaryActions({
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
  return (
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
  );
}
