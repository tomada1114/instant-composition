import { adjustLevel, suggestLevel } from "./difficulty";
import type { PracticeError } from "./errors";
import { MAX_LEVEL, placementLevel } from "./placement";
import type {
  LearnerStats,
  LevelEntry,
  LevelMode,
  ReviewEntry,
  Round,
} from "./records";
import { err, ok, type Result } from "./result";
import type { RoundOutcome } from "./round-outcome";

/** Who moves the level; stats stored before a level could be picked were all `auto`. */
export function levelModeOf(stats: LearnerStats): LevelMode {
  return stats.levelMode ?? "auto";
}

/** How the learner sets the level: back to the answers, or fixed where they pick. */
export type LevelChoice =
  { readonly mode: "auto" } | { readonly mode: "manual"; readonly level: number };

/**
 * The stats after the learner's choice, or `stats` itself when nothing moves.
 * A picked level that differs starts a fresh window, as a placement does;
 * switching mode alone keeps the level and its window, so adjusting resumes
 * from where the learner left it.
 */
export function decideLevel(
  stats: LearnerStats,
  choice: LevelChoice,
  now: number,
): Result<LearnerStats, PracticeError> {
  if (choice.mode === "auto") {
    return ok(levelModeOf(stats) === "auto" ? stats : { ...stats, levelMode: "auto" });
  }
  const { level } = choice;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  if (stats.level?.level === level) {
    return ok(
      levelModeOf(stats) === "manual" ? stats : { ...stats, levelMode: "manual" },
    );
  }
  return ok({
    ...stats,
    level: { level, reason: "chosen", roundId: null, at: now },
    levelMode: "manual",
    levelWindow: [],
  });
}

/**
 * The level the answers suggest beside one picked by hand — the same estimate
 * `auto` moves to — or null in `auto`, and while there are too few answers.
 */
export function suggestedLevel(stats: LearnerStats): number | null {
  if (levelModeOf(stats) === "auto" || stats.level === null) {
    return null;
  }
  return suggestLevel(stats.level.level, stats.levelWindow);
}

export interface LevelSettled {
  /** The new entry, or null when the level stays where it was. */
  readonly entry: LevelEntry | null;
  /** The mode the round sets: a placement hands the level back to the answers; null leaves it. */
  readonly mode: LevelMode | null;
  readonly placement: RoundOutcome["placement"];
  readonly difficulty: RoundOutcome["difficulty"];
}

/**
 * The level a placement round measured, or the move after any other round to
 * the level the window's first-pass answers show. A level picked by hand
 * stays put whatever the answers say.
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
      mode: "auto",
      placement: { level, first: stats.level === null },
      difficulty: null,
    };
  }
  const unchanged = { entry: null, mode: null, placement: null, difficulty: null };
  if (stats.level === null || levelModeOf(stats) === "manual") {
    return unchanged;
  }
  const adjusted = adjustLevel(stats.level.level, stats.levelWindow, round.startedAt);
  if (adjusted.change === "same") {
    return unchanged;
  }
  return {
    entry: {
      level: adjusted.level,
      reason: adjusted.change,
      roundId: round.id,
      at: now,
    },
    mode: null,
    placement: null,
    difficulty: { change: adjusted.change, level: adjusted.level },
  };
}
