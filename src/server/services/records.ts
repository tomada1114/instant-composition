import { reachBySubtopic } from "../../core/mastery";
import { parseTitleKey } from "../../core/milestones";
import { totals } from "../../core/points";
import { calendarDots, longestRun } from "../../core/streak";
import type { RecordsView, SettingsPageView, TitleGroup } from "../../core/views";
import { DEFAULT_SETTINGS } from "./settings";
import type { ServiceDeps } from "./deps";
import { storedPoints, streakValue } from "./finish";
import { toeic } from "./level";
import { readProgress, type Progress } from "./progress";
import { computeReach } from "./reach";

/** The TOEIC band of the level now, or null before the first placement. */
function toeicNow(progress: Progress): string | null {
  return progress.level === undefined ? null : toeic(progress, progress.level.level);
}

function titleGroups(deps: ServiceDeps, progress: Progress): TitleGroup[] {
  const streak: number[] = [];
  const reach = new Map<string, number[]>();
  for (const { key } of deps.store.titles()) {
    const title = parseTitleKey(key);
    if (title?.kind === "streak") streak.push(title.value);
    if (title?.kind === "reach")
      reach.set(title.topic, [...(reach.get(title.topic) ?? []), title.value]);
  }
  const ascending = (values: readonly number[]): number[] =>
    [...values].sort((a, b) => a - b);
  const groups: TitleGroup[] =
    streak.length > 0 ? [{ kind: "streak", values: ascending(streak) }] : [];
  for (const topic of progress.content.topics) {
    const values = reach.get(topic.id);
    if (values !== undefined) {
      groups.push({
        kind: "reach",
        topic: topic.id,
        ja: topic.ja,
        values: ascending(values),
      });
    }
  }
  return groups;
}

/** W10: mastered cards by topic and subtopic, the run, the calendar and the totals. */
export function records(deps: ServiceDeps): RecordsView {
  const progress = readProgress(deps);
  const reach = computeReach(progress, undefined);
  const bySubtopic = reachBySubtopic(reach.mastered, reach.where);
  const chosen = progress.settings?.topics ?? [];
  const all = totals(progress.answers, progress.today);
  return {
    reach: reach.view,
    breakdown: progress.content.topics
      .filter((topic) => chosen.includes(topic.id))
      .map((topic) => ({
        id: topic.id,
        ja: topic.ja,
        subtopics: topic.subtopics.map((subtopic) => ({
          id: subtopic.id,
          ja: subtopic.ja,
          count: bySubtopic.get(`${topic.id}/${subtopic.id}`) ?? 0,
        })),
      })),
    toeic: toeicNow(progress),
    streak: {
      current: streakValue(progress.completed, progress.today),
      longest: longestRun(progress.completed),
    },
    calendar: calendarDots(progress.completed, progress.today, progress.firstDay),
    said: all.said,
    practicedDays: all.practicedDays,
    points: deps.store
      .finishedRounds()
      .reduce((sum, round) => sum + storedPoints(round.summary), 0),
    titles: titleGroups(deps, progress),
  };
}

/** W11: the settings as saved (the defaults before any), the taxonomy and the difficulty. */
export function settingsPage(deps: ServiceDeps): SettingsPageView {
  const progress = readProgress(deps);
  return {
    settings: progress.settings ?? DEFAULT_SETTINGS,
    topics: progress.content.topics.map((topic) => ({
      id: topic.id,
      ja: topic.ja,
      subtopics: topic.subtopics.map(({ id, ja }) => ({ id, ja })),
    })),
    toeic: toeicNow(progress),
  };
}
