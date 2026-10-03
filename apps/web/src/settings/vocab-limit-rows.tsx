import { type ReactElement } from "react";
import { useTranslations } from "use-intl";

import type { Settings, SettingsPageView } from "../openapi";
import { InfoTip } from "../ui/info-tip";
import { Segmented } from "../ui/segmented";
import { SettingsRow } from "./settings-row";
import type { SettingsState } from "./use-settings";

type NewPerDay = Settings["vocabNewPerDay"];
/** The segmented control's value for a review limit; "unlimited" stands for `null`. */
type ReviewChoice = Exclude<Settings["vocabReviewsPerDay"], null> | "unlimited";

/** Vocabulary's two limits save on the press and apply to the next deal. */
export function VocabLimitRows({
  state,
  options,
}: Readonly<{
  state: SettingsState;
  options: SettingsPageView["options"];
}>): ReactElement {
  const t = useTranslations("Settings.daily");
  const reviews = state.settings.vocabReviewsPerDay;
  return (
    <>
      <SettingsRow
        label={t("vocabNewTitle")}
        info={
          <InfoTip
            label={t("infoLabel", { title: t("vocabNewTitle") })}
            text={t("newInfo")}
          />
        }
      >
        <Segmented<NewPerDay>
          label={t("vocabNewTitle")}
          options={options.vocabNewPerDay.map((count) => ({
            value: count,
            label: t("vocabCount", { count }),
            text: String(count),
          }))}
          value={state.settings.vocabNewPerDay}
          onChange={(newPerDay) => {
            state.save({ vocabNewPerDay: newPerDay });
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
      >
        <Segmented<ReviewChoice>
          label={t("reviewsTitle")}
          options={options.vocabReviewsPerDay.map((count) =>
            count === null
              ? { value: "unlimited", label: t("unlimited"), text: t("unlimited") }
              : {
                  value: count,
                  label: t("vocabCount", { count }),
                  text: String(count),
                },
          )}
          value={reviews ?? "unlimited"}
          onChange={(choice) => {
            state.save({ vocabReviewsPerDay: choice === "unlimited" ? null : choice });
          }}
        />
      </SettingsRow>
    </>
  );
}
