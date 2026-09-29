import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { BackHeader } from "../lib/back-header";
import { LOGOUT_URL } from "../lib/endpoints";
import type { SettingsPageView } from "../openapi";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";
import { DifficultySheet } from "./difficulty-sheet";
import {
  FocusSection,
  LimitSection,
  SizeSection,
  TopicsSection,
} from "./settings-sections";
import { TimeZoneRow } from "./time-zone-row";
import { useLevel } from "./use-level";
import { useSettings } from "./use-settings";
import { markPressed } from "../drill/pressed";

/** W12: measuring again is confirmed first; Esc and "cancel" close it. */
function RetestSheet({
  onCancel,
  onConfirm,
}: Readonly<{ onCancel: () => void; onConfirm: () => void }>): ReactElement {
  const t = useTranslations("Settings.retest");
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);
  return (
    <Sheet titleId="retest-title">
      <div className="flex flex-col gap-2">
        <h2 id="retest-title" className="text-heading">
          {t("title")}
        </h2>
        <p className="text-muted-foreground">{t("body")}</p>
      </div>
      <div className="flex flex-col gap-2.5">
        <Button variant="secondary" className="w-full" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button data-autofocus className="w-full" onClick={onConfirm}>
          {t("confirm")}
        </Button>
      </div>
    </Sheet>
  );
}

/** W11: every change saves as it is made and says in one line what it does. */
export function SettingsScreen({
  page,
}: Readonly<{ page: SettingsPageView }>): ReactElement {
  const t = useTranslations("Settings");
  const records = useTranslations("Records");
  const navigate = useNavigate();
  const state = useSettings(page.settings);
  const level = useLevel(page.difficulty, page.levels);
  const [choosing, setChoosing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [zoneFailed, setZoneFailed] = useState(false);
  const soundId = useId();

  return (
    <main className="mx-auto box-content flex max-w-column flex-col gap-10 px-4 pt-4 pb-10">
      <BackHeader title={t("title")} back={t("back")} escape={!asking && !choosing} />
      {state.failed || zoneFailed ? (
        <p role="alert" className="rounded-tile bg-raised px-4 py-3">
          {t("saveFailed")}
        </p>
      ) : null}
      <TopicsSection topics={page.topics} state={state} />
      <FocusSection topics={page.topics} state={state} />
      <SizeSection state={state} />
      <LimitSection state={state} />
      <section className="flex flex-col border-y border-border">
        <div className="flex min-h-16 items-center justify-between gap-4">
          <h2 id={soundId}>{t("sound.title")}</h2>
          <Toggle
            labelledBy={soundId}
            on={state.settings.sound}
            onChange={(sound) => {
              state.save({ sound });
            }}
          />
        </div>
        <TimeZoneRow onFailedChange={setZoneFailed} />
        <div className="flex min-h-16 items-center justify-between gap-4 border-t border-border">
          <h2 className="flex items-baseline gap-3">
            {t("difficulty.title")}
            <span className="font-mono text-mono-sm text-muted-foreground">
              {t("difficulty.state", {
                mode: t(`difficulty.${level.view.mode}`),
                level:
                  level.view.toeic === null
                    ? records("notMeasured")
                    : records("toeic", { toeic: level.view.toeic }),
              })}
            </span>
          </h2>
          <Button
            variant="text"
            className="-mr-3 text-foreground"
            onClick={() => {
              setChoosing(true);
            }}
          >
            {t("difficulty.change")}
          </Button>
        </div>
      </section>
      <form
        method="post"
        action={LOGOUT_URL}
        className="flex min-h-16 items-center justify-between gap-4 border-b border-border"
      >
        <h2>{t("signOut.title")}</h2>
        <Button type="submit" variant="text" className="-mr-3 text-foreground">
          {t("signOut.action")}
        </Button>
      </form>
      {choosing ? (
        <DifficultySheet
          level={level}
          levels={page.levels}
          onRetest={() => {
            setChoosing(false);
            setAsking(true);
          }}
          onClose={() => {
            setChoosing(false);
          }}
        />
      ) : null}
      {asking ? (
        <RetestSheet
          onCancel={() => {
            setAsking(false);
          }}
          onConfirm={() => {
            markPressed();
            void navigate({ to: "/drill", search: { kind: "placement" } });
          }}
        />
      ) : null}
    </main>
  );
}
