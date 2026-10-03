import { useTranslations } from "use-intl";
import type { ReactElement } from "react";
import { isDefaultGradeKeys, keyLabel } from "../lib/grade-keys";
import type { GradeKeyTrio } from "../openapi";

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
