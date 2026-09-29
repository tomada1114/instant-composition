import { useId, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { TUNING } from "../lib/tuning";
import type { LevelMode, Settings, SettingsPageView } from "../openapi";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { LevelPicker } from "./level-picker";
import { Heading } from "./settings-sections";
import type { LevelState } from "./use-level";
import type { SettingsState } from "./use-settings";

type LimitSeconds = Settings["limitSeconds"];

/**
 * The level: who moves it, the level itself — a pick fixes it by hand — and
 * measuring again. Each change saves as it is made; the heading carries the
 * mode and the level as they stand.
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
  const records = useTranslations("Records");
  const id = useId();
  const { view } = level;
  const current = view.level;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <Heading
        id={id}
        aside={t("state", {
          mode: t(view.mode),
          level:
            view.toeic === null
              ? records("notMeasured")
              : records("toeic", { toeic: view.toeic }),
        })}
      >
        {t("title")}
      </Heading>
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

/** The per-card time limit, taken by the next round dealt. */
export function LimitSection({
  state,
}: Readonly<{ state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.limit");
  const id = useId();
  return (
    <section className="flex flex-col gap-3">
      <Heading id={id}>{t("title")}</Heading>
      <Segmented<LimitSeconds>
        label={t("title")}
        options={TUNING.limitSeconds.map((seconds) => ({
          value: seconds,
          label: t("count", { seconds }),
          text: String(seconds),
        }))}
        value={state.settings.limitSeconds}
        onChange={(limitSeconds) => {
          state.save({ limitSeconds });
        }}
      />
      <p className="text-caption text-muted-foreground">{t("next")}</p>
    </section>
  );
}
