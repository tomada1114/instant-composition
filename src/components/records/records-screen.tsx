"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactElement, ReactNode } from "react";

import type { RecordsView } from "../../core/views";
import { BackHeader } from "@/components/lib/back-header";
import { InfoTip } from "@/components/ui/info-tip";
import { ReachRings } from "@/components/summary/reach-rings";

import { Breakdown, DotCalendar, MilestoneList } from "./records-parts";

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

/** W10: the long view. Nothing here was just earned, so nothing is lit. */
export function RecordsScreen({
  records,
}: Readonly<{ records: RecordsView }>): ReactElement {
  const t = useTranslations("Records");
  const format = useFormatter();
  return (
    <main className="mx-auto box-content flex max-w-column flex-col gap-10 px-4 pt-4 pb-10">
      <BackHeader title={t("title")} back={t("back")} />
      <div className="flex flex-col gap-3">
        <ReachRings reach={records.reach} shown={final} />
        <div className="flex flex-col border-t border-border">
          {records.breakdown.map((topic) => (
            <Breakdown key={topic.id} topic={topic} />
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <Tile
          label={t("streakLabel")}
          note={t("longest", { days: records.streak.longest })}
        >
          {records.streak.current === 0
            ? t("restart")
            : t("streak", { days: records.streak.current })}
        </Tile>
        <Tile label={t("difficulty")}>
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
    </main>
  );
}
