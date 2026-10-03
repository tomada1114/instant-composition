import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { Button } from "../ui/button";
import { isDefaultGradeKeys, keyLabel } from "../lib/grade-keys";
import type { GradeKeyTrio } from "../openapi";
import { Kbd } from "../ui/kbd";
import { Dialog } from "../ui/dialog";

/**
 * The drill's keys, listed only once the learner has used one (`keys`
 * variant): the three grades' keys — the default ones with their digits
 * beside the arrows, or the three chosen.
 */
export function KeyLegend({
  gradeKeys,
}: Readonly<{ gradeKeys: GradeKeyTrio }>): ReactElement {
  const t = useTranslations("Drill");
  const fallback = isDefaultGradeKeys(gradeKeys);
  const rows = [
    ["Space · Enter", t("card.flip")],
    [fallback ? "← · 1" : keyLabel(gradeKeys.ng), t("grade.again")],
    [fallback ? "2" : keyLabel(gradeKeys.hard), t("grade.hard")],
    [fallback ? "→ · 3" : keyLabel(gradeKeys.ok), t("grade.good")],
    ["Esc · ?", t("card.pause")],
  ] as const;
  return (
    <dl
      aria-hidden
      className="hidden grid-cols-[8rem_1fr] gap-x-4 gap-y-2 border-t border-border pt-5 text-caption text-muted-foreground keys:grid"
    >
      {rows.map(([key, label]) => (
        <div key={key} className="contents">
          <dt className="font-latin text-count whitespace-pre text-foreground">
            {key}
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}

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
