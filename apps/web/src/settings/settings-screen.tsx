import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { markPressed } from "../drill/pressed";
import { SETTINGS_TABS, searchFor, type SettingsTab } from "../lib/screen-tabs";
import { TabbedScreen } from "../lib/tabbed-screen";
import { useEscapeHome } from "../lib/use-escape-home";
import type { SettingsPageView } from "../openapi";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { AppSection } from "./app-section";
import { LevelSection } from "./level-section";
import { LimitSection } from "./limit-section";
import { FocusSection, SizeSection, TopicsSection } from "./settings-sections";
import { useLevel } from "./use-level";
import { useSettings } from "./use-settings";

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

/**
 * W11: every change saves as it is made and says in one line what it does,
 * under three tabs — what is dealt, the level and the
 * seconds per card, and the app itself. The tab is the URL's `?tab=`.
 */
export function SettingsScreen({
  page,
  tab,
}: Readonly<{ page: SettingsPageView; tab: SettingsTab }>): ReactElement {
  const t = useTranslations("Settings");
  const navigate = useNavigate();
  const state = useSettings(page.settings);
  const level = useLevel(page.difficulty, page.levels);
  const [asking, setAsking] = useState(false);
  const [zoneFailed, setZoneFailed] = useState(false);
  useEscapeHome(!asking);

  return (
    <TabbedScreen
      title={t("title")}
      tabs={SETTINGS_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
      tab={tab}
      onTab={(next) => {
        void navigate({
          to: "/settings",
          search: searchFor(SETTINGS_TABS, next),
          replace: true,
        });
      }}
      notice={
        state.failed || level.failed || zoneFailed ? (
          <p role="alert" className="rounded-control bg-raised px-4 py-3">
            {t("saveFailed")}
          </p>
        ) : null
      }
    >
      {tab === "cards" ? (
        <>
          <TopicsSection topics={page.topics} state={state} />
          <FocusSection topics={page.topics} state={state} />
          <SizeSection state={state} />
        </>
      ) : null}
      {tab === "level" ? (
        <>
          <LevelSection
            level={level}
            levels={page.levels}
            onRetest={() => {
              setAsking(true);
            }}
          />
          <LimitSection state={state} />
        </>
      ) : null}
      {tab === "app" ? (
        <AppSection state={state} onZoneFailedChange={setZoneFailed} />
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
    </TabbedScreen>
  );
}
