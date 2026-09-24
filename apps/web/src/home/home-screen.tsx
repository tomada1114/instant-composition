import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { browserSound } from "../drill/sound";
import { usePrimaryKey } from "../lib/use-primary-key";
import type { HomeView, RoundKind } from "../openapi";
import { Eyebrow } from "../ui/eyebrow";
import { ChartGlyph, GearGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { LoadFailedPanel, NotEnoughPanel } from "./home-empty";
import { DonePanel, ProgressPanel, RecoverPanel } from "./home-panels";
import { ReadyPanel } from "./home-ready";
import { SoundToggle } from "./sound-toggle";
import { StreakFigure, WeekRow } from "./streak-figure";

/**
 * W3: the streak and the week on top, today's portion and its one action in
 * the panel below. `onReload` reads the home view again, for when the cards
 * could not be read.
 */
export function HomeScreen({
  view,
  onReload,
}: Readonly<{ view: HomeView; onReload: () => void }>): ReactElement {
  const t = useTranslations("Home");
  const navigate = useNavigate();
  usePrimaryKey();

  function go(kind: RoundKind): void {
    browserSound.unlock();
    void navigate({ to: "/drill", search: { kind } });
  }

  const state = view.state;
  const streak = "streak" in state ? state.streak : undefined;

  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-1.75rem)] max-w-column flex-col gap-10 px-4 pt-4 pb-3">
      <header className="flex items-center justify-between">
        <Eyebrow>{t("brand")}</Eyebrow>
        <nav className="flex gap-2">
          <SoundToggle initial={view.sound} />
          <IconButton asChild>
            <Link to="/records" aria-label={t("records")}>
              <ChartGlyph />
            </Link>
          </IconButton>
          <IconButton asChild>
            <Link to="/settings" aria-label={t("settings")}>
              <GearGlyph />
            </Link>
          </IconButton>
        </nav>
      </header>
      {streak === undefined ? null : (
        <div className="my-auto flex flex-col gap-7">
          {streak.kind === "count" ? (
            <Eyebrow className="-mb-2" aria-hidden>
              {t("streakEyebrow")}
            </Eyebrow>
          ) : null}
          <StreakFigure streak={streak} />
          <WeekRow dots={view.week} />
        </div>
      )}
      <section className="-mx-1 mt-auto flex flex-col gap-5 rounded-card bg-card p-5">
        {view.contentError ? (
          <LoadFailedPanel onReload={onReload} />
        ) : state.kind === "ready" ? (
          <ReadyPanel view={view} go={go} />
        ) : state.kind === "in-progress" ? (
          <ProgressPanel state={state} go={go} />
        ) : state.kind === "done" ? (
          <DonePanel state={state} view={view} go={go} />
        ) : state.kind === "recover-offer" ? (
          <RecoverPanel view={view} go={go} />
        ) : state.kind === "not-enough" ? (
          <NotEnoughPanel available={state.available} />
        ) : null}
      </section>
    </main>
  );
}
