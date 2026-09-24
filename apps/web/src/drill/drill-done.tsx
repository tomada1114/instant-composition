import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { Button } from "../ui/button";
import { NoticeGlyph } from "../ui/glyphs";

import type { RoundKind } from "../openapi";
import { SummaryScreen } from "../summary/summary-screen";
import type { FinishState } from "./use-drill";

const SHELL =
  "mx-auto box-content flex min-h-[calc(100dvh-4rem)] max-w-column flex-col gap-4 px-4 py-8";

/**
 * Where a round ends: the summary once the server has it, or the notice that
 * the records are not saved yet with a way to send them again.
 */
export function DrillDone({
  finish,
  unsaved,
  dailySize,
  onNext,
  onEnd,
}: Readonly<{
  finish: FinishState;
  unsaved: number;
  dailySize: number;
  onNext: (kind: RoundKind) => void;
  onEnd: () => void;
}>): ReactElement {
  const t = useTranslations("Drill");

  if (finish.status === "failed") {
    return (
      <main className={SHELL}>
        <div className="flex items-center gap-3 rounded-tile bg-raised px-4 py-3">
          <NoticeGlyph />
          <p className="flex-1">{t("save.unsaved", { count: unsaved })}</p>
          <Button variant="text" className="px-2" onClick={finish.retry}>
            {t("save.resend")}
          </Button>
        </div>
      </main>
    );
  }
  if (finish.status !== "done") return <main className={SHELL} />;
  return (
    <SummaryScreen
      summary={finish.summary}
      dailySize={dailySize}
      onNext={onNext}
      onEnd={onEnd}
    />
  );
}
