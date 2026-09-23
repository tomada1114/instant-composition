import type { PracticeError } from "./errors";
import { emptyTally } from "./empty";
import type {
  DayTally,
  ItemProgress,
  LearnerStats,
  Portion,
  ReviewEntry,
  Round,
} from "./records";
import { err, ok, type Result } from "./result";
import { reviewAnswer } from "./review";
import { limitMsForWords } from "./timer";
import { TUNING } from "./tuning";
import type { AnswerResult, Pass } from "./types";

/** One answer as the client sends it. */
export interface AnswerInput {
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  readonly id: string;
  readonly roundId: string;
  readonly cardId: string;
  readonly pass: Pass;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
}

/** What the catalog knows of a card, or of its tombstone (`words` null). */
export interface CardFacts {
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly ja: string;
  readonly words: number | null;
}

/** Refuses the whole batch when any answer names another round or an unknown card. */
export function checkAnswers(
  round: Round,
  inputs: readonly AnswerInput[],
  cards: ReadonlyMap<string, CardFacts>,
): Result<undefined, PracticeError> {
  if (round.finishedAt !== null) {
    return err({ code: "ERR_ROUND_CLOSED" });
  }
  const valid = inputs.every(
    (input) =>
      input.roundId === round.id &&
      round.deck.includes(input.cardId) &&
      cards.has(input.cardId),
  );
  return valid ? ok(undefined) : err({ code: "ERR_BAD_REQUEST" });
}

export interface AnswersState {
  readonly round: Round;
  readonly stats: LearnerStats;
  readonly portion: Portion | undefined;
  readonly day: DayTally | undefined;
  readonly items: ReadonlyMap<string, ItemProgress>;
  /** Ids of the answers this round already holds. */
  readonly recorded: ReadonlySet<string>;
}

export interface AnswersChange {
  readonly entries: readonly ReviewEntry[];
  readonly items: readonly ItemProgress[];
  readonly round: Round;
  readonly stats: LearnerStats;
  readonly portion: Portion | undefined;
  readonly day: DayTally;
}

/**
 * Takes checked answers into `state`, in log order, skipping ids already held.
 * The limit is worked out here rather than trusted from the client, and a
 * round crossing the day boundary keeps its own day.
 */
export function decideAnswers(
  state: AnswersState,
  inputs: readonly AnswerInput[],
  cards: ReadonlyMap<string, CardFacts>,
  now: number,
): AnswersChange | undefined {
  const { round } = state;
  // Every answer of a batch is stamped `now`, so log order is id order.
  const fresh = inputs
    .filter(
      (input, index) =>
        !state.recorded.has(input.id) &&
        inputs.findIndex((other) => other.id === input.id) === index,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const items = new Map(state.items);
  const moved = new Set<string>();
  const entries: ReviewEntry[] = [];
  for (const input of fresh) {
    const card = cards.get(input.cardId);
    if (card === undefined) continue;
    const limitMs =
      card.words === null
        ? TUNING.timer.minSeconds * 1000
        : limitMsForWords(card.words);
    const reviewed = reviewAnswer(items.get(input.cardId), {
      ...input,
      sessionId: round.id,
      limitMs,
      elapsedMs:
        input.result === "timeout" ? limitMs : Math.min(input.elapsedMs, limitMs),
      day: round.day,
      answeredAt: now,
      snapshot: {
        topic: card.topic,
        subtopic: card.subtopic,
        level: card.level,
        prompt: card.ja,
      },
    });
    entries.push(reviewed.entry);
    if (input.pass === "first" && reviewed.progress !== undefined) {
      items.set(input.cardId, reviewed.progress);
      moved.add(input.cardId);
    }
  }
  if (entries.length === 0) {
    return undefined;
  }
  const firsts = entries.filter((entry) => entry.detail.pass === "first");
  const day = state.day ?? emptyTally(round.day);
  const { stats } = state;
  const level = stats.level;
  const window =
    level === null
      ? []
      : firsts
          .filter((entry) => Math.abs(entry.snapshot.level - level.level) <= 1)
          .map((entry) => ({
            level: entry.snapshot.level,
            result: entry.detail.result,
            elapsedMs: entry.detail.elapsedMs,
            limitMs: entry.detail.limitMs,
            answeredAt: entry.answeredAt,
          }));
  return {
    entries,
    items: [...moved].flatMap((id) => items.get(id) ?? []),
    round: { ...round, firstPass: round.firstPass + firsts.length },
    portion:
      state.portion === undefined
        ? undefined
        : { ...state.portion, progress: state.portion.progress + firsts.length },
    day: {
      ...day,
      answers: day.answers + entries.length,
      firstPass: day.firstPass + firsts.length,
    },
    stats: {
      ...stats,
      said: stats.said + entries.length,
      practicedDays: stats.practicedDays + (day.answers === 0 ? 1 : 0),
      firstDay:
        stats.firstDay === null || round.day < stats.firstDay
          ? round.day
          : stats.firstDay,
      levelWindow: [...stats.levelWindow, ...window].slice(-TUNING.difficulty.window),
    },
  };
}
