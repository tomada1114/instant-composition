import { deriveCardStates } from "../../core/card-state";
import { addDays, dayOf } from "../../core/day";
import type {
  AnswerRecord,
  CardMeta,
  CardState,
  DayKey,
  Settings,
} from "../../core/types";
import type { ContentSnapshot } from "../content";
import type { LevelEntry } from "../db";
import type { ServiceDeps } from "./deps";

/** Everything most services read, taken once per call. */
export interface Progress {
  readonly now: number;
  readonly today: DayKey;
  readonly settings: Settings | undefined;
  readonly level: LevelEntry | undefined;
  readonly answers: readonly AnswerRecord[];
  readonly completed: ReadonlySet<DayKey>;
  readonly content: ContentSnapshot;
  readonly contentError: boolean;
  /** The cards a round may deal. */
  readonly meta: readonly CardMeta[];
  readonly states: ReadonlyMap<string, CardState>;
  /** Cards already given a first-pass answer today: never dealt twice in a day. */
  readonly answeredToday: ReadonlySet<string>;
  readonly firstDay: DayKey | undefined;
}

const EMPTY_CONTENT: ContentSnapshot = {
  topics: [],
  toeicByLevel: new Map(),
  shown: new Map(),
  known: new Map(),
  tombstones: new Map(),
  skipped: 0,
};

/**
 * Reads the progress picture as of now.
 *
 * @param day - The day to read it for; defaults to today by the clock. A
 * round finishing after the day boundary passes its own start day.
 */
export function readProgress(deps: ServiceDeps, day?: DayKey): Progress {
  const now = deps.now();
  const today = day ?? dayOf(now);
  const loaded = deps.content.get();
  const content = loaded.ok ? loaded.value : EMPTY_CONTENT;
  const answers = deps.store.allAnswers();
  const firstPass = answers.filter((answer) => answer.pass === "first");
  return {
    now,
    today,
    settings: deps.store.getSettings(),
    level: deps.store.currentLevel(),
    answers,
    completed: deps.store.completedDays(),
    content,
    contentError: !loaded.ok,
    meta: [...content.shown.values()],
    states: deriveCardStates(answers),
    answeredToday: new Set(
      firstPass.filter((answer) => answer.day === today).map((answer) => answer.cardId),
    ),
    firstDay: answers.reduce<DayKey | undefined>(
      (first, answer) =>
        first === undefined || answer.day < first ? answer.day : first,
      undefined,
    ),
  };
}

/** First-pass answers given toward the portion credited to `creditDay`. */
export function portionProgress(
  deps: ServiceDeps,
  answers: readonly AnswerRecord[],
  creditDay: DayKey,
): number {
  const rounds = new Set(
    [...deps.store.roundsOn(creditDay), ...deps.store.roundsOn(addDays(creditDay, 1))]
      .filter((round) => round.portionDay === creditDay)
      .map((round) => round.id),
  );
  return answers.filter(
    (answer) => answer.pass === "first" && rounds.has(answer.roundId),
  ).length;
}
