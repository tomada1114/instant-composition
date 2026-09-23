import { adjustLevel } from "./difficulty";
import { placementLevel } from "./placement";
import type {
  LearnerStats,
  LevelEntry,
  ReviewEntry,
  Round,
  RoundOutcome,
} from "./records";

export interface LevelSettled {
  /** The new entry, or null when the level stays where it was. */
  readonly entry: LevelEntry | null;
  readonly placement: RoundOutcome["placement"];
  readonly difficulty: RoundOutcome["difficulty"];
}

/**
 * The level a placement round measured, or the move after any other round,
 * judged on the first-pass answers since the level last changed.
 */
export function settleLevel(
  round: Round,
  stats: LearnerStats,
  reviews: readonly ReviewEntry[],
  now: number,
): LevelSettled {
  if (round.kind === "placement") {
    const level = placementLevel(
      reviews
        .filter((review) => review.detail.pass === "first")
        .map((review) => ({ ...review.detail, level: review.snapshot.level })),
    );
    return {
      entry: { level, reason: "placement", roundId: round.id, at: now },
      placement: { level, first: stats.level === null },
      difficulty: null,
    };
  }
  if (stats.level === null) {
    return { entry: null, placement: null, difficulty: null };
  }
  const adjusted = adjustLevel(stats.level.level, stats.levelWindow);
  if (adjusted.change === "same") {
    return { entry: null, placement: null, difficulty: null };
  }
  return {
    entry: {
      level: adjusted.level,
      reason: adjusted.change,
      roundId: round.id,
      at: now,
    },
    placement: null,
    difficulty: { change: adjusted.change, level: adjusted.level },
  };
}
