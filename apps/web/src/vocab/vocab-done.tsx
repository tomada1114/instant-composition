import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { FocusStrip } from "../lib/frame";
import { usePrimaryKey } from "../lib/use-primary-key";
import type { VocabSummary } from "../openapi";
import { Button } from "../ui/button";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { PrimaryButton } from "../ui/primary-button";
/** V3: vocabulary figures and first-pass Again words, without drill celebrations. */
export function VocabDone({
  summary,
  onExtra,
  hasExtra,
}: Readonly<{
  summary: VocabSummary;
  onExtra: () => void;
  hasExtra: boolean;
}>): ReactElement {
  const t = useTranslations("Vocab");
  const nav = useTranslations("Nav");
  const navigate = useNavigate();
  usePrimaryKey();
  const title =
    summary.kind === "weak"
      ? t("weakDone")
      : summary.category === null
        ? t("done")
        : t("categoryDone", { category: t(`categories.${summary.category}`) });
  const figures = [
    [t("answered"), summary.answered],
    [t("introduced"), summary.new],
    [t("dueTomorrow"), summary.tomorrow],
  ] as const;
  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-8 py-6">
      <FocusStrip
        close={
          <IconButton plain asChild>
            <Link to="/vocab" aria-label={nav("close")}>
              <CloseGlyph />
            </Link>
          </IconButton>
        }
      />
      <h1 className="text-center">{title}</h1>
      <dl className="grid grid-cols-3 divide-x-2 divide-border">
        {figures.map(([label, count]) => (
          <div key={label} className="flex flex-col gap-2 px-3">
            <dt className="text-label text-muted-foreground">{label}</dt>
            <dd className="font-display text-figure-sm">{t("count", { count })}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap justify-center gap-3">
        {hasExtra ? (
          <Button variant="secondary" onClick={onExtra}>
            {t("extra")}
          </Button>
        ) : null}
        <PrimaryButton
          className="pc:w-auto pc:min-w-60"
          onPress={() => {
            void navigate({ to: "/vocab" });
          }}
        >
          {t("end")}
        </PrimaryButton>
      </div>
      <section className="flex flex-col gap-4 rounded-card border-2 border-border bg-card p-5">
        <h2 className="flex justify-between text-heading">
          {t("againTitle")}
          <span className="font-latin text-count">{summary.again.length}</span>
        </h2>
        {summary.again.length === 0 ? (
          <p className="text-muted-foreground">{t("againNone")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {summary.again.map((row) => (
              <li key={row.cardId} className="flex flex-wrap justify-between gap-2">
                <span className="font-latin">{row.headword}</span>
                <span className="text-muted-foreground">{row.meaning}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
