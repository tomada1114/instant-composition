import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { Button } from "../ui/button";
import { NoticeGlyph } from "../ui/glyphs";

import type { RoundKind } from "../openapi";
import { SummaryScreen } from "../summary/summary-screen";
import type { FinishState } from "./use-drill";

const STAGE = "mx-auto flex w-full max-w-reading flex-col gap-4 py-6";

/**
 * Where a round ends: the summary once the server has it, or the notice that
 * the records are not saved yet with a way to send them again. The round is
 * closed, so the strip's ✕ leaves at once.
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
}>): ReactElement | null {
  const t = useTranslations("Drill");
  return finish.status === "failed" ? (
    <div className={STAGE}>
      <div className="flex items-center gap-3 rounded-control bg-raised px-4 py-3">
        <NoticeGlyph />
        <p className="flex-1">{t("save.unsaved", { count: unsaved })}</p>
        <Button variant="text" className="px-2" onClick={finish.retry}>
          {t("save.resend")}
        </Button>
      </div>
    </div>
  ) : finish.status === "done" ? (
    <SummaryScreen
      summary={finish.summary}
      mode="live"
      dailySize={dailySize}
      onNext={onNext}
      onEnd={onEnd}
    />
  ) : null;
}
