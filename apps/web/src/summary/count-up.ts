import { useEffect, useState } from "react";

import type { RoundSummary } from "../openapi";

export interface CountUp {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly delayMs: number;
  readonly durationMs: number;
}

const STAGGER_MS = 150;
const LONGEST_MS = 600;

/**
 * The summary's values this round changed, in reading order, each starting
 * 150 ms after the last. A value the round left alone is not in the plan: it
 * is shown final from the start. A first day never counts up from 0.
 */
export function countUpPlan(summary: RoundSummary): CountUp[] {
  const moves: [string, number, number][] = [
    ["growth.faster", 0, summary.growth.faster],
    ["growth.fixed", 0, summary.growth.fixed],
    ["review", 0, summary.review.length],
  ];
  if (summary.streak.changed && summary.streak.value > 1) {
    moves.push(["streak", summary.streak.value - 1, summary.streak.value]);
  }
  for (const topic of summary.reach.topics) {
    moves.push([`reach.${topic.id}`, topic.count - topic.added, topic.count]);
  }
  moves.push(
    ["points", summary.points.total - summary.points.earned, summary.points.total],
    ["said", summary.totals.said - summary.totals.added, summary.totals.said],
  );
  return moves
    .filter(([, from, to]) => to > from)
    .map(([key, from, to], index) => ({
      key,
      from,
      to,
      delayMs: index * STAGGER_MS,
      durationMs: Math.min(LONGEST_MS, 200 + 60 * (to - from)),
    }));
}

/** Where `entry` stands `elapsedMs` after the summary appeared, in whole steps. */
export function valueAt(entry: CountUp, elapsedMs: number): number {
  const progress = Math.min(
    1,
    Math.max(0, (elapsedMs - entry.delayMs) / entry.durationMs),
  );
  const eased = 1 - (1 - progress) ** 3;
  return entry.from + Math.round((entry.to - entry.from) * eased);
}

/**
 * Milliseconds since the summary appeared, frame by frame until the last
 * count-up ends; `Infinity` when nothing moves, so every value reads final.
 */
export function useElapsed(plan: readonly CountUp[], moving: boolean): number {
  const endMs = Math.max(0, ...plan.map((entry) => entry.delayMs + entry.durationMs));
  const [animate] = useState(
    () => moving && endMs > 0 && typeof requestAnimationFrame === "function",
  );
  const [elapsed, setElapsed] = useState(animate ? 0 : Number.POSITIVE_INFINITY);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const start = performance.now();
    function tick(now: number): void {
      const since = now - start;
      setElapsed(since >= endMs ? Number.POSITIVE_INFINITY : since);
      if (since < endMs) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [animate, endMs]);

  return elapsed;
}
