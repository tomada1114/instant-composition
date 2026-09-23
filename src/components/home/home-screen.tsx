"use client";

import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import type { RoundKind } from "../../core/types";
import type { HomeView } from "../../core/views";
import { browserSound } from "@/components/drill/sound";
import { usePrimaryKey } from "@/components/lib/use-primary-key";

import { Link, useRouter } from "../../i18n/navigation";
import { LoadFailedPanel, NotEnoughPanel } from "./home-empty";
import { DonePanel, ProgressPanel, ReadyPanel, RecoverPanel } from "./home-panels";
import { SoundToggle } from "./sound-toggle";
import { StreakFigure, WeekRow } from "./streak-figure";

/** W3: the streak and the week on top, today's portion and its one action below. */
export function HomeScreen({ view }: Readonly<{ view: HomeView }>): ReactElement {
  const t = useTranslations("Home");
  const router = useRouter();
  usePrimaryKey();

  function go(kind: RoundKind): void {
    browserSound.unlock();
    router.push(`/drill?kind=${kind}`);
  }

  const state = view.state;
  const streak = "streak" in state ? state.streak : undefined;

  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-2rem)] max-w-column flex-col gap-8 px-4 py-4">
      <header className="flex items-center justify-between">
        <SoundToggle initial={view.sound} />
        <nav className="flex gap-2">
          <Link
            href="/records"
            className="flex h-11 items-center px-2 text-muted-foreground active:text-foreground"
          >
            {t("records")}
          </Link>
          <Link
            href="/settings"
            className="flex h-11 items-center px-2 text-muted-foreground active:text-foreground"
          >
            {t("settings")}
          </Link>
        </nav>
      </header>
      {streak === undefined ? null : (
        <div className="flex flex-col gap-6">
          <StreakFigure streak={streak} />
          <WeekRow dots={view.week} />
        </div>
      )}
      <div className="mt-auto flex flex-col gap-6">
        {view.contentError ? (
          <LoadFailedPanel
            onReload={() => {
              router.refresh();
            }}
          />
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
    </main>
  );
}
