import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useFormatter, useTranslations } from "use-intl";

import { markPressed } from "../drill/pressed";
import { browserSound } from "../drill/sound";
import { useShellNav } from "../lib/frame";
import { usePrimaryKey } from "../lib/use-primary-key";
import { cn } from "../lib/utils";
import type { HomeView, RoundKind } from "../openapi";
import { Eyebrow } from "../ui/eyebrow";
import { LoadFailedPanel, NotEnoughPanel } from "./home-empty";
import { DonePanel, ProgressPanel, RecoverPanel } from "./home-panels";
import { ReadyPanel } from "./home-ready";
import { HomeTiles } from "./home-tiles";
import { SoundToggle } from "./sound-toggle";
import { StreakFigure, WeekRow } from "./streak-figure";

/**
 * W3, on the dashboard grid: the date with the sound switch at its right;
 * today's panel (8 columns) beside the streak tile (4); then the three home
 * tiles. One column below `pc`.
 * `onReload` reads the home view again, for when the cards could not be read.
 */
export function HomeScreen({
  view,
  onReload,
}: Readonly<{ view: HomeView; onReload: () => void }>): ReactElement {
  const t = useTranslations("Home");
  const format = useFormatter();
  const navigate = useNavigate();
  usePrimaryKey();
  useShellNav();

  function go(kind: RoundKind): void {
    browserSound.unlock();
    markPressed();
    void navigate({ to: "/drill", search: { kind } });
  }

  const state = view.state;
  const streak = "streak" in state ? state.streak : undefined;
  const now = new Date();

  return (
    <div className="mx-auto flex w-full max-w-dashboard flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-heading">
          {format.dateTime(now, {
            month: "long",
            day: "numeric",
            weekday: "short",
          })}
        </h1>
        <SoundToggle initial={view.sound} />
      </header>
      <div className="grid grid-cols-1 gap-6 pc:grid-cols-12">
        <div
          className={cn(
            "flex flex-col gap-5 rounded-card border-2 border-border bg-card p-6",
            streak === undefined ? "pc:col-span-12" : "pc:col-span-8",
          )}
        >
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
        </div>
        {streak === undefined ? null : (
          <div className="flex flex-col gap-5 rounded-card border-2 border-border bg-card p-6 pc:col-span-4">
            {streak.kind === "count" ? (
              <Eyebrow aria-hidden>{t("streakEyebrow")}</Eyebrow>
            ) : null}
            <StreakFigure streak={streak} />
            <WeekRow dots={view.week} today={view.today} />
          </div>
        )}
      </div>
      <HomeTiles />
    </div>
  );
}
