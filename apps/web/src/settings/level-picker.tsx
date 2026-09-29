import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import type { SettingsPageView } from "../openapi";
import { Segmented } from "../ui/segmented";

type LevelOption = SettingsPageView["levels"][number];

/**
 * The ten levels by their TOEIC reference, five to a row so a phone holds them.
 * `disabled` shows the level without offering the others, while auto moves it.
 */
export function LevelPicker({
  levels,
  value,
  onChange,
  disabled = false,
}: Readonly<{
  levels: readonly LevelOption[];
  value: number | null;
  onChange: (level: number) => void;
  disabled?: boolean;
}>): ReactElement {
  const t = useTranslations("Settings.difficulty");
  return (
    <Segmented<number>
      label={t("levels")}
      columns={5}
      options={levels.map((option) => ({
        value: option.level,
        label: t("option", { toeic: option.toeic }),
        text: option.toeic,
      }))}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
