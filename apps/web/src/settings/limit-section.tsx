import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { TUNING } from "../lib/tuning";
import type { Settings } from "../openapi";
import { Segmented } from "../ui/segmented";
import { SettingsRow } from "./settings-row";
import type { SettingsState } from "./use-settings";

type LimitSeconds = Settings["limitSeconds"];
/** The per-card time limit, taken by the next round dealt. */
export function LimitSection({
  state,
}: Readonly<{ state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.limit");
  return (
    <SettingsRow
      label={t("title")}
      note={<p className="text-caption text-muted-foreground">{t("next")}</p>}
    >
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
    </SettingsRow>
  );
}
