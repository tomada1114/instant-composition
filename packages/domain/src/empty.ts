import type { DayTally, LearnerStats } from "./records";
import type { DayKey } from "./types";

export function emptyTally(day: DayKey): DayTally {
  return {
    day,
    answers: 0,
    firstPass: 0,
    roundsStarted: 0,
    roundsFinished: 0,
    lastFinishedRound: null,
  };
}

/** A learner's totals before anything has been recorded. */
export const EMPTY_STATS: LearnerStats = {
  points: 0,
  completedDays: [],
  firstDay: null,
  said: 0,
  practicedDays: 0,
  level: null,
  levelWindow: [],
  openRound: null,
  titles: [],
};
