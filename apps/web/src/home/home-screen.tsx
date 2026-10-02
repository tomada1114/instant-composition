import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { markPressed } from "../drill/pressed";
import { browserSound } from "../drill/sound";
import { useShellNav } from "../lib/frame";
import { usePrimaryKey } from "../lib/use-primary-key";
import type { HomeView, RoundKind } from "../openapi";
import { Eyebrow } from "../ui/eyebrow";
import { LoadFailedPanel, NotEnoughPanel } from "./home-empty";
import { DonePanel, ProgressPanel, RecoverPanel } from "./home-panels";
import { ReadyPanel } from "./home-ready";
import { SoundToggle } from "./sound-toggle";
import { StreakFigure, WeekRow } from "./streak-figure";

/**
 * W3: the streak and the week on top, today's portion and its one action in
 * the panel below, under the shell's navigation; the sound switch stays at
 * the top.
 * `onReload` reads the home view again, for when the cards could not be read.
 */
export function HomeScreen({
  view,
  onReload,
}: Readonly<{ view: HomeView; onReload: () => void }>): ReactElement {
  const t = useTranslations("Home");
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

  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-8">
      <header className="flex items-center justify-between">
        <Eyebrow>{t("brand")}</Eyebrow>
        <SoundToggle initial={view.sound} />
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
    </div>
  );
}
