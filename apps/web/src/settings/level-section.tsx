import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import type { LevelMode, SettingsPageView } from "../openapi";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { LevelPicker } from "./level-picker";
import { SettingsRow } from "./settings-row";
import type { LevelState } from "./use-level";

/**
 * The level: who moves it, the level itself — a pick fixes it by hand, so
 * the levels are offered only in manual or before a placement — and
 * measuring again, as rows. Each change saves as it is made, and the
 * controls themselves show the mode and the level as they stand.
 */
export function LevelSection({
  level,
  levels,
  onRetest,
}: Readonly<{
  level: LevelState;
  levels: SettingsPageView["levels"];
  onRetest: () => void;
}>): ReactElement {
  const t = useTranslations("Settings.difficulty");
  const { view } = level;
  const current = view.level;
  const note = (
    <p className="text-caption text-muted-foreground">
      {view.mode === "manual"
        ? t("manualNote")
        : view.toeic === null
          ? t("autoNote")
          : t("autoAt", { toeic: view.toeic })}
    </p>
  );
  return (
    <>
      {current === null ? null : (
        <SettingsRow label={t("mode")} note={note}>
          <Segmented<LevelMode>
            label={t("mode")}
            options={(["auto", "manual"] as const).map((mode) => ({
              value: mode,
              label: t(mode),
              text: t(mode),
            }))}
            value={view.mode}
            onChange={(mode) => {
              level.choose(
                mode === "auto" ? { mode } : { mode: "manual", level: current },
              );
            }}
          />
        </SettingsRow>
      )}
      <SettingsRow wide label={t("levels")} note={current === null ? note : undefined}>
        <LevelPicker
          levels={levels}
          value={current}
          disabled={view.mode === "auto" && current !== null}
          onChange={(picked) => {
            level.choose({ mode: "manual", level: picked });
          }}
        />
        <Button variant="secondary" className="self-start" onClick={onRetest}>
          {t("retest")}
        </Button>
      </SettingsRow>
    </>
  );
}
