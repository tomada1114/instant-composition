import { useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { TUNING } from "../lib/tuning";
import type { Settings } from "../openapi";
import { InfoTip } from "../ui/info-tip";
import { Segmented } from "../ui/segmented";
import { SettingsRow } from "./settings-row";
import type { SettingsState } from "./use-settings";

type NewPerDay = Settings["newPerDay"];
/** The segmented control's value for a review limit; "unlimited" stands for `null`. */
type ReviewChoice = Exclude<Settings["reviewsPerDay"], null> | "unlimited";

/**
 * The drill's daily limits: new sentences a day and the most reviews a day,
 * each saved on the press and taken by the next deal — today's portion is
 * retargeted at once, never below its progress, and a line under the row
 * pressed says when that completes today.
 */
export function DailyLimitRows({
  state,
}: Readonly<{ state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.daily");
  const [pressed, setPressed] = useState<"new" | "reviews" | null>(null);
  const completed = (row: "new" | "reviews"): ReactElement | undefined =>
    state.completedToday && pressed === row ? (
      <p role="status" className="text-caption text-muted-foreground">
        {t("completed")}
      </p>
    ) : undefined;
  const reviews = state.settings.reviewsPerDay;
  return (
    <>
      <SettingsRow
        label={t("newTitle")}
        info={
          <InfoTip
            label={t("infoLabel", { title: t("newTitle") })}
            text={t("newInfo")}
          />
        }
        note={completed("new")}
      >
        <Segmented<NewPerDay>
          label={t("newTitle")}
          options={TUNING.newPerDay.map((count) => ({
            value: count,
            label: t("count", { count }),
            text: String(count),
          }))}
          value={state.settings.newPerDay}
          onChange={(newPerDay) => {
            setPressed("new");
            state.save({ newPerDay });
          }}
        />
      </SettingsRow>
      <SettingsRow
        label={t("reviewsTitle")}
        info={
          <InfoTip
            label={t("infoLabel", { title: t("reviewsTitle") })}
            text={t("reviewsInfo")}
          />
        }
        note={completed("reviews")}
      >
        <Segmented<ReviewChoice>
          label={t("reviewsTitle")}
          options={TUNING.reviewsPerDay.map((count) =>
            count === null
              ? { value: "unlimited", label: t("unlimited"), text: t("unlimited") }
              : { value: count, label: t("count", { count }), text: String(count) },
          )}
          value={reviews ?? "unlimited"}
          onChange={(choice) => {
            setPressed("reviews");
            state.save({ reviewsPerDay: choice === "unlimited" ? null : choice });
          }}
        />
      </SettingsRow>
    </>
  );
}
