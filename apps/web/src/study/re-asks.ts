import { TUNING } from "../lib/tuning";
import type { Grade } from "../openapi";
import type { StudyState, ReAsk } from "./study-state";

/**
 * In-session re-asks, in place of a retry pass at the round's end: a card
 * comes back after a few other cards until it is graded ○ — a card new to the
 * learner once more after its first ○ — and a reload drops whatever waits.
 * The schedule is the server's; this only decides what the session shows.
 */

/** How many other cards come before the card graded `grade` returns; `undefined` when it leaves. */
function gapAfter(grade: Grade, isNew: boolean, goods: number): number | undefined {
  if (grade === "again") return TUNING.reAsk.again;
  if (grade === "hard") return TUNING.reAsk.hard;
  return isNew && goods === 1 ? TUNING.reAsk.newGood : undefined;
}

/** The current card's re-ask, if `grade` sets one, and its tally of ○. */
export function afterGrade(
  state: StudyState,
  grade: Grade,
): Pick<StudyState, "reAsks" | "goods"> {
  const card = state.card;
  if (card === undefined) return state;
  const { cardId } = card;
  const goods = (state.goods[cardId] ?? 0) + (grade === "good" ? 1 : 0);
  const room = state.retries && (state.asked[cardId] ?? 0) < TUNING.reAsk.max;
  const gap = room ? gapAfter(grade, state.isNew[cardId] === true, goods) : undefined;
  return {
    goods: { ...state.goods, [cardId]: goods },
    reAsks:
      gap === undefined
        ? state.reAsks
        : [...state.reAsks, { cardId, due: state.step + gap + 1 }],
  };
}

/** The re-ask that fell due first; the earlier set wins a tie. */
function earliest(reAsks: readonly ReAsk[]): ReAsk | undefined {
  let best: ReAsk | undefined;
  for (const reAsk of reAsks)
    if (best === undefined || reAsk.due < best.due) best = reAsk;
  return best;
}

/**
 * The session with its next card on screen, or `undefined` when nothing is
 * left. A re-ask that has fallen due comes before the next first pass; once
 * no first pass is left, the waiting ones come without waiting, in the order
 * they fell due, never the card just shown while another waits.
 */
export function nextCard(state: StudyState): StudyState | undefined {
  const step = state.step + 1;
  const due = earliest(state.reAsks.filter((reAsk) => reAsk.due <= step));
  const [first, ...rest] = state.fresh;
  if (due === undefined && first !== undefined) {
    return {
      ...state,
      fresh: rest,
      firstShown: state.firstShown + 1,
      step,
      card: { cardId: first, pass: "first", ask: 0 },
    };
  }
  if (due === undefined && state.hasMore === true) return undefined;
  const last = state.card?.cardId;
  const reAsk =
    due ??
    earliest(state.reAsks.filter((waiting) => waiting.cardId !== last)) ??
    earliest(state.reAsks);
  if (reAsk === undefined) return undefined;
  const ask = (state.asked[reAsk.cardId] ?? 0) + 1;
  return {
    ...state,
    reAsks: state.reAsks.filter((waiting) => waiting !== reAsk),
    asked: { ...state.asked, [reAsk.cardId]: ask },
    step,
    card: { cardId: reAsk.cardId, pass: "retry", ask },
  };
}
