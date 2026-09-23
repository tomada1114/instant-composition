import { useTranslations } from "next-intl";
import { useId, type ReactElement } from "react";

import type { ReachTopic, ReachView } from "../../core/views";
import { cn } from "@/components/lib/utils";

import type { Shown } from "./summary-parts";

const STROKE = 10;
const RING_GAP = 6;
const SEGMENT_GAP_PX = 2;

/**
 * One ring's groove, its fill up to before this round, and this round's
 * segment in the accent after a 2px gap. `count` is the value shown now,
 * so the new segment grows while the count climbs.
 */
function Ring({
  topic,
  count,
  radius,
  center,
}: Readonly<{
  topic: ReachTopic;
  count: number;
  radius: number;
  center: number;
}>): ReactElement {
  const done = topic.ring.done - (topic.count - count);
  const old = Math.max(0, topic.ring.done - topic.added);
  const scale = 100 / topic.ring.span;
  const gap = (SEGMENT_GAP_PX / (2 * Math.PI * radius)) * 100;
  const arc = (from: number, length: number, className: string): ReactElement | null =>
    length <= 0 ? null : (
      <circle
        cx={center}
        cy={center}
        r={radius}
        pathLength={100}
        strokeDasharray={`${String(length)} 100`}
        strokeDashoffset={-from}
        className={className}
      />
    );
  return (
    <g
      fill="none"
      strokeWidth={STROKE}
      transform={`rotate(-90 ${String(center)} ${String(center)})`}
    >
      <circle cx={center} cy={center} r={radius} className="stroke-border" />
      {arc(0, Math.min(old, done) * scale, "stroke-foreground")}
      {done > old
        ? arc(
            old * scale + (old > 0 ? gap : 0),
            (done - old) * scale - (old > 0 ? gap : 0),
            "stroke-accent",
          )
        : null}
    </g>
  );
}

function Label({
  topic,
  count,
}: Readonly<{ topic: ReachTopic; count: number }>): ReactElement {
  const t = useTranslations("Summary.reach");
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-label">{topic.ja}</span>
      <span className="font-latin">{count}</span>
      {topic.added > 0 ? (
        <span className="text-label text-accent">
          {t("added", { count: topic.added })}
        </span>
      ) : null}
    </p>
  );
}

/** The chosen topics' mastered counts: nested rings up to four, a grid of five. */
export function ReachRings({
  reach,
  shown,
}: Readonly<{ reach: ReachView; shown: Shown }>): ReactElement {
  const t = useTranslations("Summary.reach");
  const id = useId();
  const count = (topic: ReachTopic): number => shown(`reach.${topic.id}`, topic.count);
  const empty = reach.topics.every((topic) => topic.count === 0);
  const grid = reach.topics.length > 4;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id}>{t("title")}</h2>
      {grid ? (
        <ul data-layout="grid" className="grid grid-cols-2 gap-x-4 gap-y-4">
          {reach.topics.map((topic) => (
            <li key={topic.id} className="flex items-center gap-3">
              <svg aria-hidden viewBox="0 0 72 72" className="size-18 shrink-0">
                <Ring topic={topic} count={count(topic)} radius={31} center={36} />
              </svg>
              <Label topic={topic} count={count(topic)} />
            </li>
          ))}
        </ul>
      ) : (
        <div data-layout="concentric" className="flex items-center gap-6">
          <svg aria-hidden viewBox="0 0 200 200" className="size-50 shrink-0">
            {reach.topics.map((topic, index) => (
              <Ring
                key={topic.id}
                topic={topic}
                count={count(topic)}
                radius={100 - STROKE / 2 - index * (STROKE + RING_GAP)}
                center={100}
              />
            ))}
          </svg>
          <ul className="flex flex-col gap-2">
            {reach.topics.map((topic) => (
              <li key={topic.id}>
                <Label topic={topic} count={count(topic)} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {empty ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : reach.nearest === null ? null : (
        <div className={cn("flex flex-col")}>
          <p className="text-caption text-muted-foreground">{t("next")}</p>
          <p>
            {t("nearest", { topic: reach.nearest.ja, count: reach.nearest.remaining })}
          </p>
        </div>
      )}
    </section>
  );
}
