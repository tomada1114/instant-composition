import { useNavigate } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";

import { RECORDS_TABS, searchFor, type RecordsTab } from "../lib/screen-tabs";
import { SELF_SCROLL, TabbedScreen } from "../lib/tabbed-screen";
import { useEscapeHome } from "../lib/use-escape-home";
import { cn } from "../lib/utils";
import type { RecordsView } from "../openapi";
import { ReachRings } from "../summary/reach-rings";
import { InfoTip } from "../ui/info-tip";
import { Breakdown, DotCalendar, MilestoneList, WeakList } from "./records-parts";

function final(_key: string, value: number): number {
  return value;
}

/** One figure with its name on a surface tile. */
function Tile({
  label,
  children,
  note,
}: Readonly<{ label: string; children: ReactNode; note?: string }>): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-tile bg-card p-4">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="font-display text-figure-sm">{children}</span>
        {note === undefined ? null : (
          <span className="font-mono text-eyebrow text-muted-foreground">{note}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * The run, the level and the totals as tiles, then the calendar and the
 * milestones; the milestones scroll inside what is left of the tab.
 */
function History({ records }: Readonly<{ records: RecordsView }>): ReactElement {
  const t = useTranslations("Records");
  const format = useFormatter();
  return (
    <>
      <dl className="grid grid-cols-2 gap-2">
        <Tile
          label={t("streakLabel")}
          note={t("longest", { days: records.streak.longest })}
        >
          {records.streak.current === 0
            ? t("restart")
            : t("streak", { days: records.streak.current })}
        </Tile>
        <Tile
          label={t("difficulty")}
          note={
            records.suggestedToeic === null
              ? t(records.levelMode)
              : t("suggested", { toeic: records.suggestedToeic })
          }
        >
          {records.toeic === null
            ? t("notMeasured")
            : t("toeic", { toeic: records.toeic })}
        </Tile>
        <div className="col-span-2 grid grid-cols-3 gap-2">
          <Tile label={t("said")}>{format.number(records.said)}</Tile>
          <Tile label={t("days")}>{format.number(records.practicedDays)}</Tile>
          <Tile label={t("points")}>{format.number(records.points)}</Tile>
        </div>
      </dl>
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-1">
          <h2 className="text-muted-foreground">{t("calendar")}</h2>
          <InfoTip label={t("rules.label")} text={t("rules.streak")} />
        </div>
        <DotCalendar weeks={records.calendar} />
      </section>
      <MilestoneList groups={records.titles} />
    </>
  );
}

/**
 * W10: the long view, under three tabs that each fit a phone — how far each
 * topic has come, the weak points, and the run and the totals. Nothing here
 * was just earned, so nothing is lit. The tab is the URL's `?tab=`.
 */
export function RecordsScreen({
  records,
  tab,
}: Readonly<{ records: RecordsView; tab: RecordsTab }>): ReactElement {
  const t = useTranslations("Records");
  const navigate = useNavigate();
  useEscapeHome();
  return (
    <TabbedScreen
      title={t("title")}
      tabs={RECORDS_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
      tab={tab}
      onTab={(next) => {
        void navigate({
          to: "/records",
          search: searchFor(RECORDS_TABS, next),
          replace: true,
        });
      }}
    >
      {tab === "overview" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ReachRings reach={records.reach} shown={final} />
          {/* Inset by 6 so the rows' focus outline is not clipped by the scroll. */}
          <div className={cn("-m-1.5 min-h-15 p-1.5", SELF_SCROLL)}>
            <div className="flex flex-col border-t border-border">
              {records.breakdown.map((topic) => (
                <Breakdown key={topic.id} topic={topic} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {tab === "weak" ? <WeakList weak={records.weak} /> : null}
      {tab === "history" ? <History records={records} /> : null}
    </TabbedScreen>
  );
}
