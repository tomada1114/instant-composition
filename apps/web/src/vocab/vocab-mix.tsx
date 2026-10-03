import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import type { VocabHub } from "../openapi";
/** The same split bar as Today, without the drill's focus and grammar labels. */
export function VocabMix({
  today,
}: Readonly<{ today: VocabHub["today"] }>): ReactElement {
  const t = useTranslations("Vocab");
  const total = Math.max(1, today.due + today.new);
  return (
    <div className="flex flex-col gap-2.5">
      <div aria-hidden className="flex h-2 gap-0.5">
        {today.due > 0 ? (
          <span
            className="rounded-full bg-foreground"
            style={{ width: `${String((today.due / total) * 100)}%` }}
          />
        ) : null}
        {today.new > 0 ? (
          <span className="flex-1 rounded-full bg-muted-foreground" />
        ) : null}
      </div>
      <p className="flex flex-wrap gap-4 text-caption text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-foreground" />
          {t("review", { count: today.due })}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-muted-foreground" />
          {t("fresh", { count: today.new })}
        </span>
      </p>
    </div>
  );
}
