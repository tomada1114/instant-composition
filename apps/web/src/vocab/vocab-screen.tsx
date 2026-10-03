import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { browserSound } from "../study/sound";
import { useShellNav } from "../lib/frame";
import { useEscapeHome } from "../lib/use-escape-home";
import { usePrimaryKey } from "../lib/use-primary-key";
import type { VocabHub } from "../openapi";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { CheckGlyph, ChevronGlyph } from "../ui/glyphs";
import { InfoTip } from "../ui/info-tip";
import { PrimaryButton } from "../ui/primary-button";
import { VocabMix } from "./vocab-mix";
/** V1: Today, category rows and the weak queue, in one reading-width column. */
export function VocabScreen({ hub }: Readonly<{ hub: VocabHub }>): ReactElement {
  const t = useTranslations("Vocab");
  const navigate = useNavigate();
  useShellNav();
  useEscapeHome();
  usePrimaryKey();
  const done = hub.today.due + hub.today.new === 0;
  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-6">
      <h1>{t("title")}</h1>
      {hub.empty ? (
        <section className="flex flex-col gap-2 rounded-panel border-2 border-border bg-card p-7">
          <h2>{t("empty")}</h2>
          <p className="text-muted-foreground">{t("emptyBody")}</p>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-5 rounded-card border-2 border-border bg-card p-6">
            {done ? (
              <>
                <h2 className="flex items-center gap-3">
                  <CheckGlyph />
                  {t("done")}
                </h2>
                <p className="text-count text-muted-foreground">
                  {t("tomorrow", { count: hub.tomorrow })}
                </p>
                {hub.extra > 0 ? (
                  <Button asChild variant="secondary" className="self-end">
                    <Link to="/vocab/study" search={{ kind: "extra" }}>
                      {t("extra", { count: hub.extra })}
                    </Link>
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Eyebrow>{t("today")}</Eyebrow>
                <p className="font-display text-figure-sm">
                  {t("size", {
                    count: hub.today.due + hub.today.new,
                    minutes: hub.today.minutes,
                  })}
                </p>
                <VocabMix today={hub.today} />
                <PrimaryButton
                  className="self-end pc:w-auto pc:min-w-60"
                  onPress={() => {
                    browserSound.unlock();
                    void navigate({ to: "/vocab/study", search: { kind: "today" } });
                  }}
                >
                  {t("start")}
                </PrimaryButton>
              </>
            )}
          </section>
          <section
            aria-label={t("title")}
            className="overflow-hidden rounded-card border-2 border-border bg-card"
          >
            {hub.categories.map((row) => {
              const empty = row.due + row.new === 0;
              return (
                <Link
                  key={row.category}
                  to="/vocab/study"
                  search={{ kind: "today", category: row.category }}
                  aria-disabled={empty}
                  onClick={(event) => {
                    if (empty) event.preventDefault();
                  }}
                  className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 border-b-2 border-border px-5 py-3 last:border-b-0 aria-disabled:text-muted-foreground aria-disabled:hover:bg-card hover:bg-raised"
                >
                  <span>{t(`categories.${row.category}`)}</span>
                  <span className="text-count">
                    {empty
                      ? t("noneToday")
                      : `${t("review", { count: row.due })} · ${t("fresh", { count: row.new })}`}
                  </span>
                  <span className="ml-auto text-count text-muted-foreground">
                    {t("learning", { count: row.learning, total: row.total })}
                  </span>
                  {empty ? null : <ChevronGlyph className="-rotate-90" />}
                </Link>
              );
            })}
          </section>
          <section className="flex flex-wrap items-center rounded-card border-2 border-border bg-card px-5">
            <InfoTip label={t("weak")} text={t("weakInfo")} />
            <Link
              to="/vocab/study"
              search={{ kind: "weak" }}
              aria-disabled={hub.weak === 0}
              onClick={(event) => {
                if (hub.weak === 0) event.preventDefault();
              }}
              className="flex min-h-14 flex-1 items-center gap-4 px-3 aria-disabled:text-muted-foreground aria-disabled:hover:bg-card hover:bg-raised"
            >
              <span>{t("weak")}</span>
              <span className="ml-auto text-count">
                {hub.weak === 0 ? t("weakNone") : t("count", { count: hub.weak })}
              </span>
              {hub.weak === 0 ? null : <ChevronGlyph className="-rotate-90" />}
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
