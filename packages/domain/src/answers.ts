import type { AnswerInput, CardFacts } from "./check-answers";
import { inLevelBand } from "./compose-pick";
import { emptyTally } from "./empty";
import type {
  DayTally,
  ItemProgress,
  LearnerStats,
  Portion,
  ReviewEntry,
  Round,
} from "./records";
import { reviewAnswer } from "./review";
import { limitMsOf, paceMsOf, paceOf } from "./timer";
import { TUNING } from "./tuning";

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
 * A client's time held between the round's start and the server's; the
 * server's clock wins should the round seem to start after it.
 */
function clampAnsweredAt(
  reported: number | undefined,
  round: Round,
  now: number,
): number {
  return Math.min(Math.max(reported ?? now, round.startedAt), now);
}

/**
 * Takes checked answers into `state`, in log order, skipping ids already held.
 * Each is held to its round's limit, not the setting now, and judged by its
 * card's pace, neither trusted from the client; a round crossing the day
 * boundary keeps its own day, so a late answer is taken for the day it was given.
 */
export function decideAnswers(
  state: AnswersState,
  inputs: readonly AnswerInput[],
  cards: ReadonlyMap<string, CardFacts>,
  now: number,
): AnswersChange | undefined {
  const { round } = state;
  const fresh = inputs
    .filter(
      (input, index) =>
        !state.recorded.has(input.id) &&
        inputs.findIndex((other) => other.id === input.id) === index,
    )
    .map((input) => ({
      input,
      answeredAt: clampAnsweredAt(input.answeredAt, round, now),
    }))
    .sort(
      (a, b) => a.answeredAt - b.answeredAt || a.input.id.localeCompare(b.input.id),
    );
  const items = new Map(state.items);
  const moved = new Set<string>();
  const entries: ReviewEntry[] = [];
  for (const { input, answeredAt } of fresh) {
    const card = cards.get(input.cardId);
    if (card === undefined) continue;
    const paceMs = paceMsOf(card.words);
    const limitMs = limitMsOf(round, paceMs);
    const reviewed = reviewAnswer(items.get(input.cardId), {
      ...input,
      sessionId: round.id,
      limitMs,
      paceMs,
      elapsedMs:
        input.result === "timeout" ? limitMs : Math.min(input.elapsedMs, limitMs),
      day: round.day,
      answeredAt,
      snapshot: {
        topic: card.topic,
        subtopic: card.subtopic,
        level: card.level,
        prompt: card.prompt,
      },
    });
    entries.push(reviewed.entry);
    if (
      reviewed.progress !== undefined &&
      reviewed.progress !== items.get(input.cardId)
    ) {
      items.set(input.cardId, reviewed.progress);
      moved.add(input.cardId);
    }
  }
  if (entries.length === 0) return undefined;
  const firsts = entries.filter((entry) => entry.detail.pass === "first");
  const day = state.day ?? emptyTally(round.day);
  const { stats } = state;
  const { level } = stats;
  const window =
    level === null
      ? []
      : firsts
          .filter((entry) => entry.answeredAt >= level.at) // older: before this level was set
          .filter((entry) => inLevelBand(entry.snapshot.level, level.level))
          .map((entry) => ({
            cardId: entry.item.id,
            level: entry.snapshot.level,
            result: entry.detail.result,
            elapsedMs: entry.detail.elapsedMs,
            limitMs: entry.detail.limitMs,
            paceMs: paceOf(entry.detail),
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
      // A late answer may be older than the window's newest, so it is sorted in.
      levelWindow: [...stats.levelWindow, ...window]
        .sort((a, b) => a.answeredAt - b.answeredAt)
        .slice(-TUNING.difficulty.window),
    },
  };
}
