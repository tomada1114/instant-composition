import type { VocabError } from "./errors";
import { scheduleCard } from "./fsrs";
import type { QueuedCard } from "./queue";
import { err, ok, type Result } from "./result";
import { VOCAB_TUNING } from "./tuning";
import type { Pass } from "./types";
import {
  isNewCard,
  type VocabAnswer,
  type VocabCategory,
  type VocabProgress,
  type VocabReview,
  type VocabSession,
  type VocabSessionKind,
  type VocabSnapshot,
  type VocabState,
} from "./vocab";
import { dueTomorrow, inCategory, vocabQueue, weakCards } from "./vocab-queue";

/**
 * The cards a session of `kind` deals, in order: today's queue, the extra
 * cards past it, or the weak cards, at most `VOCAB_TUNING.weak.sessionSize`
 * and outside the daily limits. A category restricts each to its own cards,
 * which share today's limits with the others.
 */
export function dealVocab(
  state: VocabState,
  kind: VocabSessionKind,
  category: VocabCategory | null,
): QueuedCard[] {
  const wanted = inCategory(state, category);
  if (kind === "weak") {
    return weakCards(state).filter(wanted).slice(0, VOCAB_TUNING.weak.sessionSize);
  }
  const { queue, extra } = vocabQueue(state);
  return kind === "today"
    ? queue.filter(wanted)
    : extra.filter(wanted).slice(0, VOCAB_TUNING.extraSize);
}

function count(cards: readonly QueuedCard[], kind: QueuedCard["kind"]): number {
  return cards.filter((card) => card.kind === kind).length;
}

/**
 * What the hub shows: today's reviews and new cards and the minutes they
 * take, each category's share of them with how many of its cards are in
 * learning and in all, the weak cards a weak session could deal, and
 * tomorrow's reviews.
 */
export function vocabFigures(state: VocabState): {
  readonly due: number;
  readonly fresh: number;
  readonly minutes: number;
  readonly categories: readonly {
    readonly category: VocabCategory;
    readonly due: number;
    readonly fresh: number;
    readonly learning: number;
    readonly total: number;
  }[];
  readonly weak: number;
  readonly tomorrow: number;
} {
  const { queue } = vocabQueue(state);
  return {
    due: count(queue, "review"),
    fresh: count(queue, "new"),
    minutes: Math.ceil((queue.length * VOCAB_TUNING.secondsPerCard) / 60),
    categories: VOCAB_TUNING.categories.map((category) => {
      const share = queue.filter(inCategory(state, category));
      const cards = state.cards.filter((card) => card.category === category);
      return {
        category,
        due: count(share, "review"),
        fresh: count(share, "new"),
        learning: cards.filter((card) => !isNewCard(state.progress.get(card.id)))
          .length,
        total: cards.length,
      };
    }),
    weak: weakCards(state).length,
    tomorrow: dueTomorrow(state),
  };
}

/** Whether an answer for `day` moves the card: only its first answer of a practice day does. */
function moves(progress: VocabProgress | undefined, pass: Pass, day: string): boolean {
  const lastDay = progress?.state?.lastDay;
  return pass === "first" && (lastDay === undefined || lastDay < day);
}

/**
 * Takes a batch into the session's log, in the order it was given, skipping
 * ids already held and answers for a card the catalog no longer shows. A
 * card's first answer of the session's day sets its schedule; a re-ask, and
 * any later answer that day, is logged with the state it found. A batch with
 * a new id for a finished session, or naming a card it did not deal, is
 * refused whole.
 */
export function decideVocabAnswers(
  state: {
    readonly session: VocabSession;
    readonly progress: ReadonlyMap<string, VocabProgress>;
    /** Ids of the answers the session already holds. */
    readonly recorded: ReadonlySet<string>;
  },
  inputs: readonly VocabAnswer[],
  cards: ReadonlyMap<string, VocabSnapshot>,
  now: number,
): Result<
  {
    readonly entries: readonly VocabReview[];
    readonly moved: readonly VocabProgress[];
  },
  VocabError
> {
  const { session } = state;
  const fresh = inputs.filter(
    (input, index) =>
      !state.recorded.has(input.id) &&
      inputs.findIndex((other) => other.id === input.id) === index,
  );
  if (session.finishedAt !== null && fresh.length > 0) {
    return err({ code: "ERR_SESSION_CLOSED" });
  }
  if (!fresh.every((input) => session.deck.includes(input.cardId))) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const progress = new Map(state.progress);
  const moved = new Set<string>();
  const entries: VocabReview[] = [];
  const ordered = fresh
    .map((input) => ({
      input,
      answeredAt: Math.min(Math.max(input.answeredAt ?? now, session.startedAt), now),
    }))
    .sort(
      (a, b) => a.answeredAt - b.answeredAt || a.input.id.localeCompare(b.input.id),
    );
  for (const { input, answeredAt } of ordered) {
    const snapshot = cards.get(input.cardId);
    if (snapshot === undefined) continue;
    const current = progress.get(input.cardId);
    const before = current?.state ?? null;
    const after = moves(current, input.pass, session.day)
      ? scheduleCard(before ?? undefined, input.grade, session.day, input.cardId).state
      : before;
    const { id, cardId, pass, grade, elapsedMs } = input;
    entries.push({
      ...{ id, sessionId: session.id, cardId, answeredAt, day: session.day },
      ...{ pass, grade, elapsedMs, before, after, snapshot },
    });
    if (after !== before) {
      progress.set(cardId, {
        cardId,
        source: current?.source ?? { kind: "catalog" },
        state: after,
        firstDay: current?.firstDay ?? session.day,
      });
      moved.add(cardId);
    }
  }
  return ok({ entries, moved: [...moved].flatMap((id) => progress.get(id) ?? []) });
}
