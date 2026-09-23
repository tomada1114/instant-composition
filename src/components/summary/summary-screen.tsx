"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, type ReactElement } from "react";

import type { RoundKind } from "../../core/types";
import type { RoundSummary } from "../../core/views";
import { prefersReducedMotion } from "@/components/drill/motion";
import { usePrimaryKey } from "@/components/lib/use-primary-key";
import { Button } from "@/components/ui/button";
import { CloseGlyph } from "@/components/ui/glyphs";
import { PrimaryButton } from "@/components/ui/primary-button";

import { Link, useRouter } from "../../i18n/navigation";
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
 * `recap` (W9r) re-reads today's last summary with every value final.
 */
export function SummaryScreen({
  summary,
  mode,
  dailySize,
  onNext,
}: Readonly<{
  summary: RoundSummary;
  mode: "live" | "recap";
  dailySize: number;
  onNext: (kind: RoundKind) => void;
}>): ReactElement {
  const t = useTranslations("Summary");
  const router = useRouter();
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

  function end(): void {
    router.push("/");
  }

  useEffect(() => {
    if (live) {
      heading.current?.focus();
      return;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") router.push("/");
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [live, router]);

  const title = live
    ? summary.yesterday
      ? t("title.yesterday")
      : t("title.today")
    : t("title.recap");
  const placement = summary.placement;

  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-2rem)] max-w-column flex-col px-4 pt-4">
      <header className="flex min-h-11 items-center justify-between gap-4">
        {live ? null : (
          <Link
            href="/"
            className="flex h-11 items-center pr-2 text-muted-foreground active:text-foreground"
          >
            <span aria-hidden>←&nbsp;</span>
            {t("back")}
          </Link>
        )}
        <h1 ref={heading} tabIndex={-1} className="flex-1 focus-visible:outline-none">
          {title}
        </h1>
        {live ? (
          <button
            type="button"
            aria-label={t("close")}
            onClick={end}
            className="-mr-3 flex size-11 items-center justify-center text-muted-foreground active:text-foreground"
          >
            <CloseGlyph />
          </button>
        ) : null}
      </header>
      <div className="flex flex-col gap-10 py-6">
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
        <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-3 bg-background px-4 pt-2 pb-4">
          {summary.yesterday ? (
            summary.todayOpen ? (
              <>
                <Button variant="secondary" onClick={end}>
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
              <PrimaryButton onPress={end}>{t("actions.end")}</PrimaryButton>
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
              <PrimaryButton onPress={end}>{t("actions.end")}</PrimaryButton>
            </>
          )}
        </footer>
      ) : null}
    </main>
  );
}
