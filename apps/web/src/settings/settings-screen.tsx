import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { markPressed } from "../drill/pressed";
import { useShellNav } from "../lib/frame";
import { useEscapeHome } from "../lib/use-escape-home";
import type { SettingsPageView } from "../openapi";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { AppRows, SignOutRow } from "./app-section";
import { LevelSection } from "./level-section";
import { LimitSection } from "./limit-section";
import { SectionList, useCurrentSection } from "./section-list";
import { SettingsSection } from "./settings-row";
import { DailyLimitRows } from "./daily-limit-rows";
import { FocusSection, TopicsSection } from "./settings-sections";
import { useLevel } from "./use-level";
import { useSettings } from "./use-settings";

/** W12: measuring again is confirmed first; Esc and "cancel" close it. */
function RetestDialog({
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
    <Dialog titleId="retest-title">
      <div className="flex flex-col gap-2">
        <h2 id="retest-title" className="text-heading">
          {t("title")}
        </h2>
        <p className="text-muted-foreground">{t("body")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" className="w-full" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button data-autofocus className="w-full" onClick={onConfirm}>
          {t("confirm")}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * W11, one page: every change saves as it is made and says in one line what
 * it does — what is dealt, the level and the seconds per card, the app, and
 * the account — with a list of those sections beside the rows.
 */
export function SettingsScreen({
  page,
}: Readonly<{ page: SettingsPageView }>): ReactElement {
  const t = useTranslations("Settings");
  const navigate = useNavigate();
  const state = useSettings(page.settings);
  const level = useLevel(page.difficulty, page.levels);
  const [asking, setAsking] = useState(false);
  const [zoneFailed, setZoneFailed] = useState(false);
  const [current, choose] = useCurrentSection();
  useShellNav();
  useEscapeHome(!asking);

  return (
    <div className="mx-auto flex w-full max-w-dashboard flex-col gap-6">
      <h1>{t("title")}</h1>
      <div className="flex flex-col gap-8 pc:flex-row pc:items-start pc:gap-10">
        <SectionList current={current} onChoose={choose} />
        <div className="flex w-full max-w-reading min-w-0 flex-col gap-10">
          {state.failed || level.failed || zoneFailed ? (
            <p role="alert" className="rounded-control bg-raised px-4 py-3">
              {t("saveFailed")}
            </p>
          ) : null}
          <SettingsSection id="cards" title={t("sections.cards")}>
            <TopicsSection topics={page.topics} state={state} />
            <FocusSection topics={page.topics} state={state} />
            <DailyLimitRows state={state} />
          </SettingsSection>
          <SettingsSection id="level" title={t("difficulty.title")}>
            <LevelSection
              level={level}
              levels={page.levels}
              onRetest={() => {
                setAsking(true);
              }}
            />
            <LimitSection state={state} />
          </SettingsSection>
          <SettingsSection id="app" title={t("sections.app")}>
            <AppRows state={state} onZoneFailedChange={setZoneFailed} />
          </SettingsSection>
          <SettingsSection id="account" title={t("signOut.title")}>
            <SignOutRow />
          </SettingsSection>
        </div>
      </div>
      {asking ? (
        <RetestDialog
          onCancel={() => {
            setAsking(false);
          }}
          onConfirm={() => {
            markPressed();
            void navigate({ to: "/drill", search: { kind: "placement" } });
          }}
        />
      ) : null}
    </div>
  );
}
