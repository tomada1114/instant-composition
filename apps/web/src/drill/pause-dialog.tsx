import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { Button } from "../ui/button";
import { KeyLegend } from "../study/key-legend";
import type { GradeKeyTrio } from "../openapi";
import { Kbd } from "../ui/kbd";
import { Dialog } from "../ui/dialog";

/** W8: stop here or go on; focus waits on "continue", which Escape also presses. */
export function PauseDialog({
  position,
  dayBoundaryHour,
  gradeKeys,
  onQuit,
  onContinue,
}: Readonly<{
  position: number;
  dayBoundaryHour: number;
  gradeKeys: GradeKeyTrio;
  onQuit: () => void;
  onContinue: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.dialog");
  return (
    <Dialog titleId="pause-title">
      <div className="flex flex-col gap-2">
        <h2 id="pause-title" className="text-heading">
          {t("title")}
        </h2>
        <p className="font-latin text-count text-muted-foreground">
          {t("hint", { hour: dayBoundaryHour, position })}
        </p>
      </div>
      <KeyLegend gradeKeys={gradeKeys} />
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" className="w-full" onClick={onQuit}>
          {t("quit")}
        </Button>
        <Button className="w-full" data-autofocus onClick={onContinue}>
          {t("continue")}
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </Dialog>
  );
}
