import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { KeyLegend } from "../drill/pause-dialog";
import type { GradeKeyTrio } from "../openapi";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Kbd } from "../ui/kbd";
/** Pause and navigation confirmation explain vocabulary's fresh-session reload behavior. */
export function VocabDialog({
  leaving,
  gradeKeys,
  onLeave,
  onStay,
}: Readonly<{
  leaving: boolean;
  gradeKeys: GradeKeyTrio;
  onLeave: () => void;
  onStay: () => void;
}>): ReactElement {
  const t = useTranslations("Drill");
  const vocab = useTranslations("Vocab");
  return (
    <Dialog titleId="vocab-pause-title">
      <div className="flex flex-col gap-2">
        <h2 id="vocab-pause-title">{leaving ? t("leave.title") : t("dialog.title")}</h2>
        <p className="text-caption text-muted-foreground">{vocab("reloadHint")}</p>
      </div>
      {leaving ? null : <KeyLegend gradeKeys={gradeKeys} />}
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onLeave}>
          {leaving ? t("leave.go") : t("dialog.quit")}
        </Button>
        <Button data-autofocus onClick={onStay}>
          {t("dialog.continue")}
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </Dialog>
  );
}
