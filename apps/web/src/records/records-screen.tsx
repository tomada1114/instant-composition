import type { ReactElement, ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";

import { useShellNav } from "../lib/frame";
import { useEscapeHome } from "../lib/use-escape-home";
import { cn } from "../lib/utils";
import type { RecordsView } from "../openapi";
import { ReachRings } from "../summary/reach-rings";
import { InfoTip } from "../ui/info-tip";
import { Breakdown, DotCalendar, MilestoneList, WeakList } from "./records-parts";

function final(_key: string, value: number): number {
  return value;
}

/** One `figures-row` cell: its name, the figure, and an optional note. */
function Figure({
  label,
  children,
  note,
  className,
}: Readonly<{
  label: string;
  children: ReactNode;
  note?: string;
  className?: string;
}>): ReactElement {
  return (
    <div className={cn("flex flex-col gap-2 bg-card p-5", className)}>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="font-display text-number-md">{children}</span>
        {note === undefined ? null : (
          <span className="text-caption text-muted-foreground">{note}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * `figures-row`: the run, the totals and the level as five cells parted by
 * 2px rules — the rules are the border colour showing between the cells.
 */
function FiguresRow({ records }: Readonly<{ records: RecordsView }>): ReactElement {
  const t = useTranslations("Records");
  const format = useFormatter();
  return (
    <dl
      data-part="figures"
      className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-panel border-2 border-border bg-border pc:grid-cols-5"
    >
      <Figure
        label={t("streakLabel")}
        note={t("longest", { days: records.streak.longest })}
      >
        {records.streak.current === 0
          ? t("restart")
          : t("streak", { days: records.streak.current })}
      </Figure>
      <Figure label={t("said")}>{format.number(records.said)}</Figure>
      <Figure label={t("days")}>{format.number(records.practicedDays)}</Figure>
      <Figure label={t("points")}>{format.number(records.points)}</Figure>
      <Figure
        label={t("difficulty")}
        note={
          records.suggestedToeic === null
            ? t(records.levelMode)
            : t("suggested", { toeic: records.suggestedToeic })
        }
        className="col-span-2 pc:col-span-1"
      >
        {records.toeic === null
          ? t("notMeasured")
          : t("toeic", { toeic: records.toeic })}
      </Figure>
    </dl>
  );
}

/** A panel on the page's 12-column grid from `pc`, the full width below it. */
function Panel({
  span,
  children,
}: Readonly<{
  span: "pc:col-span-8" | "pc:col-span-4";
  children: ReactNode;
}>): ReactElement {
  return (
    <div
      data-part="panel"
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-panel border-2 border-border bg-card p-6",
        span,
      )}
    >
      {children}
    </div>
  );
}

/**
 * W10, one page: the figures across the top, then how far each topic has
 * come beside the weak points, then the calendar beside the milestones.
 * Nothing here was just earned, so nothing is lit; the page scrolls, and
 * nothing scrolls inside itself.
 */
export function RecordsScreen({
  records,
}: Readonly<{ records: RecordsView }>): ReactElement {
  const t = useTranslations("Records");
  useShellNav();
  useEscapeHome();
  return (
    <div className="mx-auto flex w-full max-w-dashboard flex-col gap-6">
      <h1>{t("title")}</h1>
      <FiguresRow records={records} />
      <div className="grid gap-6 pc:grid-cols-12">
        <Panel span="pc:col-span-8">
          <ReachRings reach={records.reach} shown={final} />
          <div className="flex flex-col border-t-2 border-border">
            {records.breakdown.map((topic) => (
              <Breakdown key={topic.id} topic={topic} />
            ))}
          </div>
        </Panel>
        <Panel span="pc:col-span-4">
          <WeakList weak={records.weak} />
        </Panel>
        <Panel span="pc:col-span-8">
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-1">
              <h2 className="text-muted-foreground">{t("calendar")}</h2>
              <InfoTip label={t("rules.label")} text={t("rules.streak")} />
            </div>
            <DotCalendar weeks={records.calendar} />
          </section>
        </Panel>
        <Panel span="pc:col-span-4">
          <MilestoneList groups={records.titles} />
        </Panel>
      </div>
    </div>
  );
}
