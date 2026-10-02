import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { Button } from "../ui/button";
import { isDefaultGradeKeys, keyLabel } from "../lib/grade-keys";
import { TUNING } from "../lib/tuning";
import type { GradeKeys } from "../openapi";
import { Kbd } from "../ui/kbd";
import { Dialog } from "../ui/dialog";

/**
 * The drill's keys, listed only once the learner has used one (`keys`
 * variant): the default pair with the letters beside it, or the pair chosen.
 */
function KeyLegend({ gradeKeys }: Readonly<{ gradeKeys: GradeKeys }>): ReactElement {
  const t = useTranslations("Drill.card");
  const fallback = isDefaultGradeKeys(gradeKeys);
  const rows = [
    ["Space", t("flip")],
    [fallback ? "→  K  F" : keyLabel(gradeKeys.ok), t("said")],
    [fallback ? "←  J  D" : keyLabel(gradeKeys.ng), t("notSaid")],
    ["Esc  ?", t("pause")],
  ] as const;
  return (
    <dl
      aria-hidden
      className="hidden grid-cols-[5rem_1fr] gap-x-4 gap-y-2 border-t border-border pt-5 text-caption text-muted-foreground keys:grid"
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
  gradeKeys,
  onQuit,
  onContinue,
}: Readonly<{
  position: number;
  gradeKeys: GradeKeys;
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
          {t("hint", { hour: TUNING.dayBoundaryHour, position })}
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
