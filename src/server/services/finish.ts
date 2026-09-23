import type { AnswerInput } from "../../core/api";
import { reviewList, roundGrowth } from "../../core/growth";
import { newTitles } from "../../core/milestones";
import { roundPoints, totals } from "../../core/points";
import { err, ok, type Result } from "../../core/result";
import { streakStatus, weekDots, type CompletedDays } from "../../core/streak";
import type { DayKey } from "../../core/types";
import type { RoundSummary } from "../../core/views";
import type { RoundRow } from "../db";
import { ingestAnswers } from "./answer";
import type { ServiceDeps, ServiceError } from "./deps";
import { settleLevel } from "./level";
import { portionProgress, readProgress } from "./progress";
import { computeReach } from "./reach";

/** The run shown for `day`; 0 stands for "day 1 from today" and is never displayed. */
function streakValue(completed: CompletedDays, day: DayKey): number {
  const status = streakStatus(completed, day);
  return status.kind === "broken" ? 0 : status.current;
}

function storedPoints(summary: unknown): number {
  if (typeof summary !== "object" || summary === null || !("points" in summary)) {
    return 0;
  }
  const points = summary.points;
  return typeof points === "object" &&
    points !== null &&
    "earned" in points &&
    typeof points.earned === "number"
    ? points.earned
    : 0;
}

/** Completes the portion when this round took it to its target. */
function settlePortion(deps: ServiceDeps, round: RoundRow, now: number): boolean {
  if (round.portionDay === null) {
    return false;
  }
  const portion = deps.store.getPortion(round.portionDay);
  if (portion?.completedAt !== null) {
    return false;
  }
  const done = portionProgress(deps, deps.store.allAnswers(), round.portionDay);
  if (done < portion.target) {
    return false;
  }
  deps.store.completePortion(round.portionDay, now, round.id);
  return true;
}

/**
 * Closes `round` and works out everything its end screen shows, in one go so
 * the summary saved is the one every later request is answered with.
 */
export function closeRound(deps: ServiceDeps, round: RoundRow): RoundSummary {
  const day = round.day;
  const before = readProgress(deps, day);
  const portionCompleted = settlePortion(deps, round, before.now);
  const progress = readProgress(deps, day);
  const level = settleLevel(deps, progress, round);

  const reach = computeReach(progress, round.id);
  const streakBefore = streakValue(before.completed, day);
  const streakAfter = streakValue(progress.completed, day);
  const titles = newTitles({
    streakBefore,
    streakAfter,
    reachBefore: reach.before,
    reachAfter: reach.after,
    topicOrder: progress.content.topics.map((topic) => topic.id),
    awarded: new Set(deps.store.titles().map((title) => title.key)),
  });
  for (const key of titles) {
    deps.store.awardTitle(key, progress.now, round.id);
  }

  const inRound = progress.answers.filter((answer) => answer.roundId === round.id);
  const earned = roundPoints(
    inRound.filter((answer) => answer.pass === "first").length,
    portionCompleted,
  );
  const earlierPoints = deps.store
    .finishedRounds()
    .reduce((sum, finished) => sum + storedPoints(finished.summary), 0);

  const summary: RoundSummary = {
    roundId: round.id,
    kind: round.kind,
    day,
    yesterday: round.kind === "yesterday",
    ...level,
    growth: roundGrowth({
      roundId: round.id,
      answers: progress.answers,
      existing: new Set(progress.content.shown.keys()),
    }),
    review: reviewList(round.id, progress.answers),
    streak: {
      value: streakAfter,
      restart: streakAfter === 0,
      changed: portionCompleted,
    },
    week: weekDots(progress.completed, day, progress.firstDay),
    filled: portionCompleted ? round.portionDay : null,
    reach: reach.view,
    titles,
    topicNames: Object.fromEntries(progress.content.topics.map((t) => [t.id, t.ja])),
    points: { earned, total: earlierPoints + earned },
    totals: { ...totals(progress.answers, day), added: inRound.length },
    portionCompleted,
    todayOpen: round.kind === "yesterday" && !progress.completed.has(day),
    continueToday:
      round.kind === "placement" &&
      round.portionDay === day &&
      !progress.completed.has(day),
  };
  deps.store.finishRound(round.id, progress.now, summary);
  return summary;
}

/** Takes in the round's answers, then closes it; a finished round answers its saved summary. */
export function finishRound(
  deps: ServiceDeps,
  roundId: string,
  answers: readonly AnswerInput[],
): Result<RoundSummary, ServiceError> {
  const round = deps.store.getRound(roundId);
  if (round === undefined) {
    return err({ code: "ERR_ROUND_NOT_FOUND" });
  }
  if (round.finishedAt !== null) {
    return ok(round.summary as RoundSummary);
  }
  const ingested = ingestAnswers(deps, round, answers);
  if (!ingested.ok) {
    return ingested;
  }
  return ok(deps.store.transaction(() => closeRound(deps, round)));
}
