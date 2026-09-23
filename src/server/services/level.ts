import { adjustLevel } from "../../core/difficulty";
import { placementLevel } from "../../core/placement";
import type { RoundSummary } from "../../core/views";
import type { RoundRow } from "../db";
import type { ServiceDeps } from "./deps";
import type { Progress } from "./progress";

export interface LevelOutcome {
  readonly placement: RoundSummary["placement"];
  readonly difficulty: RoundSummary["difficulty"];
}

export function toeic(progress: Progress, level: number): string {
  return progress.content.toeicByLevel.get(level) ?? "";
}

/**
 * Sets the level a placement round measured, or moves it after any other
 * round, recording the change so the next window starts empty.
 */
export function settleLevel(
  deps: ServiceDeps,
  progress: Progress,
  round: RoundRow,
): LevelOutcome {
  const firstPass = progress.answers.filter((answer) => answer.pass === "first");
  if (round.kind === "placement") {
    const level = placementLevel(
      firstPass.filter((answer) => answer.roundId === round.id),
    );
    deps.store.addLevel({
      level,
      reason: "placement",
      roundId: round.id,
      at: progress.now,
    });
    return {
      placement: {
        level,
        toeic: toeic(progress, level),
        first: progress.level === undefined,
      },
      difficulty: null,
    };
  }

  const current = progress.level;
  if (current === undefined) {
    return { placement: null, difficulty: null };
  }
  const adjusted = adjustLevel(
    current.level,
    firstPass.filter((answer) => answer.answeredAt > current.at),
  );
  if (adjusted.change === "same") {
    return { placement: null, difficulty: null };
  }
  deps.store.addLevel({
    level: adjusted.level,
    reason: adjusted.change,
    roundId: round.id,
    at: progress.now,
  });
  return {
    placement: null,
    difficulty: { change: adjusted.change, toeic: toeic(progress, adjusted.level) },
  };
}
