import { useId, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import type { LevelMode, SettingsPageView } from "../openapi";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { LevelPicker } from "./level-picker";
import { Heading } from "./settings-sections";
import type { LevelState } from "./use-level";

/**
 * The level: who moves it, the level itself — a pick fixes it by hand — and
 * measuring again. Each change saves as it is made, and the controls
 * themselves show the mode and the level as they stand.
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
  const id = useId();
  const { view } = level;
  const current = view.level;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <Heading id={id}>{t("title")}</Heading>
      {current === null ? null : (
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
      )}
      <LevelPicker
        levels={levels}
        value={current}
        onChange={(picked) => {
          level.choose({ mode: "manual", level: picked });
        }}
      />
      <p className="text-caption text-muted-foreground">
        {view.mode === "auto" ? t("autoNote") : t("manualNote")}
      </p>
      <Button variant="secondary" className="w-full" onClick={onRetest}>
        {t("retest")}
      </Button>
    </section>
  );
}
