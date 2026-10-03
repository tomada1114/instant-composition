import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactElement, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Tile } from "./home-tile";
import { VocabTile } from "./vocab-tile";
import { RECORDS_QUERY } from "../lib/queries";
import type { ReachTopic, RecordsView, WeakPoints } from "../openapi";
import { Button } from "../ui/button";
import { ArrowGlyph } from "../ui/glyphs";

/** The most names a weak row shows on home; the records page lists them all. */
const WEAK_NAMES = 3;

/** The `text` link from a records tile to the records page. */
function SeeRecords(): ReactElement {
  const t = useTranslations("Home.tiles");
  return (
    <Button asChild variant="text" className="-mx-3 -mb-2">
      <Link to="/records">
        {t("seeRecords")}
        <ArrowGlyph className="size-4" />
      </Link>
    </Button>
  );
}

/** What a records tile holds: nothing before the read answers, one line when it failed. */
function RecordsBody({
  records,
  failed,
  children,
}: Readonly<{
  records: RecordsView | undefined;
  failed: boolean;
  children: (records: RecordsView) => ReactNode;
}>): ReactNode {
  const t = useTranslations("Home.tiles");
  if (failed) return <p className="text-muted-foreground">{t("failed")}</p>;
  if (records === undefined) return null;
  return children(records);
}

/** The weak grammar and scenes by name, at most three a kind, weakest first. */
function WeakRows({ weak }: Readonly<{ weak: WeakPoints }>): ReactElement {
  const t = useTranslations("Records.weak");
  const rows = [
    { key: "grammar", label: t("grammar"), names: weak.grammar.map((row) => row.name) },
    {
      key: "subtopics",
      label: t("subtopics"),
      names: weak.subtopics.map((row) => row.name),
    },
  ].filter((row) => row.names.length > 0);
  if (rows.length === 0) return <p className="text-muted-foreground">{t("none")}</p>;
  return (
    <dl className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-0.5">
          <dt className="text-label text-muted-foreground">{row.label}</dt>
          <dd>{row.names.slice(0, WEAK_NAMES).join("、")}</dd>
        </div>
      ))}
    </dl>
  );
}

/** `reach-bars`: one topic's mastered count over a pill toward its next milestone, this session's growth after a gap. */
function ReachBar({ topic }: Readonly<{ topic: ReachTopic }>): ReactElement {
  const span = Math.max(1, topic.ring.span);
  const grown = Math.min(topic.added, topic.ring.done);
  const old = Math.max(0, topic.ring.done - grown);
  const share = (value: number): string =>
    `${String(Math.min(1, value / span) * 100)}%`;
  return (
    <li className="flex flex-col gap-1.5">
      <p className="flex items-baseline justify-between">
        <span className="text-label text-muted-foreground">{topic.name}</span>
        <span className="font-display text-figure-sm tabular-nums">{topic.count}</span>
      </p>
      <span aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-raised">
        {old > 0 ? (
          <span
            data-part="fill"
            className="rounded-full bg-foreground"
            style={{ width: share(old) }}
          />
        ) : null}
        {grown > 0 ? (
          <span
            data-part="grown"
            className="ml-0.5 rounded-full bg-good-ink"
            style={{ width: share(grown) }}
          />
        ) : null}
      </span>
    </li>
  );
}

function ReachRows({
  topics,
}: Readonly<{ topics: readonly ReachTopic[] }>): ReactElement {
  const t = useTranslations("Summary.reach");
  if (topics.every((topic) => topic.count === 0)) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {topics.map((topic) => (
        <ReachBar key={topic.id} topic={topic} />
      ))}
    </ul>
  );
}

/**
 * Home's four tiles: the weak points and the reach, read from the records
 * query beside the home view — titles alone until it answers, one line if it
 * fails, while the rest of home works — and the talk, with its own start.
 */
export function HomeTiles({
  talkTurns,
}: Readonly<{ talkTurns: number }>): ReactElement {
  const t = useTranslations("Home.tiles");
  const talk = useTranslations("Talk.start");
  const records = useQuery(RECORDS_QUERY);
  const failed = records.isError;
  return (
    <div className="grid grid-cols-1 gap-6 pc:grid-cols-2">
      <VocabTile />
      <Tile
        title={t("talk")}
        foot={
          <Button asChild variant="secondary" className="w-full">
            <Link to="/talk">{t("talkStart")}</Link>
          </Button>
        }
      >
        <p className="flex items-baseline gap-1.5">
          <span className="font-display text-figure-sm">{talkTurns}</span>
          <span className="font-latin text-count text-muted-foreground">
            {talk("turns")}
          </span>
        </p>
        <p className="text-muted-foreground">{talk("scene")}</p>
      </Tile>
      <Tile title={t("weak")} foot={<SeeRecords />}>
        <RecordsBody records={records.data} failed={failed}>
          {(view) => <WeakRows weak={view.weak} />}
        </RecordsBody>
      </Tile>
      <Tile title={t("reach")} foot={<SeeRecords />}>
        <RecordsBody records={records.data} failed={failed}>
          {(view) => <ReachRows topics={view.reach.topics} />}
        </RecordsBody>
      </Tile>
    </div>
  );
}
