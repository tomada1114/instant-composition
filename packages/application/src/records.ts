import {
  calendarDots,
  EMPTY_STATS,
  longestRun,
  ok,
  parseTitleKey,
  reachBySubtopic,
  reachByTopic,
  streakValue,
  type ItemProgress,
  type Result,
  type SubtopicRef,
} from "@instant-composition/domain";

import { placeOf, snapshotOrEmpty, toeicOf, type CatalogSnapshot } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor, todayOf, type ApplicationDeps } from "./execute";
import { reachViewOf } from "./present";
import type { RecordsView, TitleGroup } from "./query-views";

function titleGroups(keys: readonly string[], snapshot: CatalogSnapshot): TitleGroup[] {
  const streak: number[] = [];
  const reach = new Map<string, number[]>();
  for (const key of keys) {
    const title = parseTitleKey(key);
    if (title?.kind === "streak") streak.push(title.value);
    if (title?.kind === "reach")
      reach.set(title.topic, [...(reach.get(title.topic) ?? []), title.value]);
  }
  const ascending = (values: readonly number[]): number[] =>
    [...values].sort((a, b) => a - b);
  const groups: TitleGroup[] =
    streak.length > 0 ? [{ kind: "streak", values: ascending(streak) }] : [];
  for (const topic of snapshot.topics) {
    const values = reach.get(topic.id);
    if (values !== undefined) {
      groups.push({
        kind: "reach",
        topic: topic.id,
        name: topic.name,
        values: ascending(values),
      });
    }
  }
  return groups;
}

/** Where each mastered item belongs: its card, else its retired entry, else its last review. */
function masteredPlaces(
  items: readonly ItemProgress[],
  snapshot: CatalogSnapshot,
): Map<string, SubtopicRef> {
  const place = placeOf(snapshot);
  return new Map(
    items
      .filter((item) => item.mastered !== null)
      .map((item) => {
        const ref = place(item.item.id) ?? item.placement;
        return [item.item.id, { topic: ref.topic, subtopic: ref.subtopic }];
      }),
  );
}

/** Mastered cards by topic and subtopic, the run, the calendar and the totals. */
export async function records(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<RecordsView, ApplicationError>> {
  const bound = storeFor(deps, context, "records");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const [{ snapshot }, settings, stored, items] = await Promise.all([
    snapshotOrEmpty(deps.catalog),
    store.settings(),
    store.stats(),
    store.items(),
  ]);
  const stats = stored?.value ?? EMPTY_STATS;
  const today = todayOf(context);
  const completed = new Set(stats.completedDays);
  const where = masteredPlaces(
    [...items.values()].map((item) => item.value),
    snapshot,
  );
  const byTopic = reachByTopic(where.keys(), where);
  const bySubtopic = reachBySubtopic(where.keys(), where);
  const chosen = snapshot.topics.filter((topic) =>
    (settings?.value.topics ?? []).includes(topic.id),
  );
  return ok({
    reach: reachViewOf(
      chosen.map((topic) => ({
        topic: topic.id,
        count: byTopic.get(topic.id) ?? 0,
        added: 0,
      })),
      snapshot,
    ),
    breakdown: chosen.map((topic) => ({
      id: topic.id,
      name: topic.name,
      subtopics: topic.subtopics.map((subtopic) => ({
        id: subtopic.id,
        name: subtopic.name,
        count: bySubtopic.get(`${topic.id}/${subtopic.id}`) ?? 0,
      })),
    })),
    toeic: stats.level === null ? null : toeicOf(snapshot, stats.level.level),
    streak: { current: streakValue(completed, today), longest: longestRun(completed) },
    calendar: calendarDots(completed, today, stats.firstDay ?? undefined),
    said: stats.said,
    practicedDays: stats.practicedDays,
    points: stats.points,
    titles: titleGroups(stats.titles, snapshot),
  });
}
