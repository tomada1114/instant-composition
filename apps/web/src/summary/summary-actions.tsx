import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import type { RoundKind, RoundSummary } from "../openapi";
import { Button } from "../ui/button";
import { PrimaryButton } from "../ui/primary-button";

/**
 * The buttons under the hero of a live summary, side by side with the main
 * one at the right: one more round, today's portion, or the end.
 */
export function SummaryActions({
  summary,
  dailySize,
  onNext,
  onEnd,
}: Readonly<{
  summary: RoundSummary;
  dailySize: number;
  onNext: (kind: RoundKind) => void;
  onEnd: () => void;
}>): ReactElement {
  const t = useTranslations("Summary");
  return (
    <div
      data-part="summary-actions"
      className="flex w-full max-w-progress gap-3 *:flex-1"
    >
      {summary.yesterday ? (
        summary.todayOpen ? (
          <>
            <Button variant="secondary" onClick={onEnd}>
              {t("actions.end")}
            </Button>
            <PrimaryButton
              onPress={() => {
                onNext("today");
              }}
            >
              {t("actions.today")}
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton onPress={onEnd}>{t("actions.end")}</PrimaryButton>
        )
      ) : (
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onNext("extra");
            }}
          >
            {t("actions.more", { count: dailySize })}
          </Button>
          <PrimaryButton onPress={onEnd}>{t("actions.end")}</PrimaryButton>
        </>
      )}
    </div>
  );
}
