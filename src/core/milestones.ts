import { TUNING, type MilestoneSeries } from "./tuning";

function lastFixed(series: MilestoneSeries): number {
  return series.fixed.at(-1) ?? 0;
}

/** The first milestone above `count`. */
export function nextMilestone(count: number, series: MilestoneSeries): number {
  const fixed = series.fixed.find((milestone) => milestone > count);
  if (fixed !== undefined) {
    return fixed;
  }
  return (Math.floor(count / series.step) + 1) * series.step;
}

/** The last milestone at or below `count`, or 0 before the first. */
export function previousMilestone(count: number, series: MilestoneSeries): number {
  const last = lastFixed(series);
  if (count >= last) {
    return Math.max(last, Math.floor(count / series.step) * series.step);
  }
  return series.fixed.filter((milestone) => milestone <= count).at(-1) ?? 0;
}

/** Every milestone `m` with `before < m <= after`, in order. */
export function crossedMilestones(
  before: number,
  after: number,
  series: MilestoneSeries,
): number[] {
  const crossed: number[] = [];
  for (
    let m = nextMilestone(before, series);
    m <= after;
    m = nextMilestone(m, series)
  ) {
    crossed.push(m);
  }
  return crossed;
}

export interface TitleInput {
  readonly streakBefore: number;
  readonly streakAfter: number;
  readonly reachBefore: ReadonlyMap<string, number>;
  readonly reachAfter: ReadonlyMap<string, number>;
  /** Topic ids in `content/taxonomy.json`'s order. */
  readonly topicOrder: readonly string[];
  readonly awarded: ReadonlySet<string>;
}

export interface TitleSeries {
  readonly streak: MilestoneSeries;
  readonly reach: MilestoneSeries;
}

/**
 * Title keys a round has just earned, streak first and then topic by topic,
 * leaving out any already awarded: a title is never shown twice or withdrawn.
 */
export function newTitles(
  input: TitleInput,
  series: TitleSeries = {
    streak: TUNING.streakMilestones,
    reach: TUNING.reachMilestones,
  },
): string[] {
  const streak = crossedMilestones(
    input.streakBefore,
    input.streakAfter,
    series.streak,
  ).map((value) => `streak:${String(value)}`);
  const reach = input.topicOrder.flatMap((topic) =>
    crossedMilestones(
      input.reachBefore.get(topic) ?? 0,
      input.reachAfter.get(topic) ?? 0,
      series.reach,
    ).map((value) => `reach:${topic}:${String(value)}`),
  );
  return [...streak, ...reach].filter((key) => !input.awarded.has(key));
}

export type ParsedTitle =
  | { readonly kind: "streak"; readonly value: number }
  | { readonly kind: "reach"; readonly topic: string; readonly value: number };

export function parseTitleKey(key: string): ParsedTitle | undefined {
  const streak = /^streak:(\d+)$/u.exec(key);
  if (streak?.[1] !== undefined) {
    return { kind: "streak", value: Number(streak[1]) };
  }
  const reach = /^reach:([^:]+):(\d+)$/u.exec(key);
  if (reach?.[1] !== undefined && reach[2] !== undefined) {
    return { kind: "reach", topic: reach[1], value: Number(reach[2]) };
  }
  return undefined;
}
