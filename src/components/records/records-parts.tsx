import { useTranslations } from "next-intl";
import { useId, useState, type ReactElement } from "react";

import type { Dot } from "../../core/streak";
import type { BreakdownTopic, TitleGroup } from "../../core/views";
import { cn } from "@/components/lib/utils";

/** `disclosure` + `bar-list`: one topic's mastered cards per subtopic, opened in place. */
export function Breakdown({
  topic,
}: Readonly<{ topic: BreakdownTopic }>): ReactElement {
  const t = useTranslations("Records");
  const [open, setOpen] = useState(false);
  const id = useId();
  const name = t("breakdown", { topic: topic.ja });
  const most = Math.max(1, ...topic.subtopics.map((subtopic) => subtopic.count));
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex h-11 items-center justify-between text-left"
      >
        <span>{name}</span>
        <span aria-hidden className="text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <ul id={id} aria-label={name} className="flex flex-col gap-2 pb-2">
          {topic.subtopics.map((subtopic) => (
            <li
              key={subtopic.id}
              className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3"
            >
              <span className="truncate">{subtopic.ja}</span>
              <span className="h-2 overflow-hidden rounded-full bg-border">
                <span
                  data-part="fill"
                  className="block h-full rounded-full bg-foreground"
                  style={{ width: `${String((subtopic.count / most) * 100)}%` }}
                />
              </span>
              <span className="text-right font-mono text-mono-sm tabular-nums">
                {subtopic.count}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const DOT: Readonly<Record<Dot["state"], string>> = {
  done: "bg-foreground",
  gap: "border-[1.5px] border-foreground",
  missed: "bg-border",
  upcoming: "border border-border",
};

/** `dot-calendar`: twelve weeks as columns, Monday to Sunday down each; never the accent. */
export function DotCalendar({
  weeks,
}: Readonly<{ weeks: readonly (readonly Dot[])[] }>): ReactElement {
  const t = useTranslations("Records");
  return (
    <div role="img" aria-label={t("calendar")} className="flex gap-1">
      {weeks.map((week) => (
        <div key={week[0]?.day} className="flex flex-col gap-1">
          {week.map((dot) => (
            <span
              key={dot.day}
              data-state={dot.state}
              className={cn("size-2.5 rounded-full", DOT[dot.state])}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** `milestone-list`: the milestones taken, the streak's row first, then each topic's. */
export function MilestoneList({
  groups,
}: Readonly<{ groups: readonly TitleGroup[] }>): ReactElement {
  const t = useTranslations("Records.titles");
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-label">
        {t("title")}
      </h2>
      {groups.length === 0 ? (
        <p className="text-muted-foreground">{t("none")}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {groups.map((group) => (
            <div
              key={group.kind === "streak" ? "streak" : group.topic}
              className="contents"
            >
              <dt className="text-label text-muted-foreground">
                {group.kind === "streak" ? t("streak") : group.ja}
              </dt>
              <dd className="tabular-nums">{group.values.join("・")}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
