"use client";

import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import type { RecordsView } from "../../core/views";
import { BackHeader } from "@/components/lib/back-header";
import { ReachRings } from "@/components/summary/reach-rings";

import { Breakdown, DotCalendar, MilestoneList } from "./records-parts";

function final(_key: string, value: number): number {
  return value;
}

/** W10: the long view. Nothing here was just earned, so nothing is lit. */
export function RecordsScreen({
  records,
}: Readonly<{ records: RecordsView }>): ReactElement {
  const t = useTranslations("Records");
  return (
    <main className="mx-auto box-content flex max-w-column flex-col gap-10 px-4 py-4">
      <BackHeader title={t("title")} back={t("back")} />
      <div className="flex flex-col gap-2">
        <ReachRings reach={records.reach} shown={final} />
        <div className="flex flex-col border-t border-border">
          {records.breakdown.map((topic) => (
            <Breakdown key={topic.id} topic={topic} />
          ))}
        </div>
      </div>
      <p className="flex gap-3">
        <span className="text-label text-muted-foreground">{t("difficulty")}</span>
        <span>
          {records.toeic === null
            ? t("notMeasured")
            : t("toeic", { toeic: records.toeic })}
        </span>
      </p>
      <section className="flex flex-col gap-4">
        <p className="flex items-baseline gap-6">
          <span className="text-heading">
            {records.streak.current === 0
              ? t("restart")
              : t("streak", { days: records.streak.current })}
          </span>
          <span className="text-caption text-muted-foreground">
            {t("longest", { days: records.streak.longest })}
          </span>
        </p>
        <DotCalendar weeks={records.calendar} />
      </section>
      <div className="flex flex-col gap-1">
        <p>{t("totals", { said: records.said, days: records.practicedDays })}</p>
        <p className="text-caption text-muted-foreground">
          {t("points", { points: records.points })}
        </p>
      </div>
      <MilestoneList groups={records.titles} />
      <div className="flex flex-col gap-1 text-caption text-muted-foreground">
        <p>{t("rules.mastered")}</p>
        <p>{t("rules.streak")}</p>
      </div>
    </main>
  );
}
