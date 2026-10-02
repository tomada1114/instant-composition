import type { TalkError } from "./errors";
import { seededRandom } from "./random";
import { err, ok, type Result } from "./result";
import type { CardCandidate, Talk, TalkCards, Turn } from "./talk";
import { TALK_TUNING } from "./tuning";
import type { VocabProgress } from "./vocab";
import { fitsCardText, normalizeHeadword, type PersonalCard } from "./vocab-card";

/** The turns a talk's candidates come from: each one corrected, give-ups included. */
export function correctedTurns(talk: Talk): Turn[] {
  return talk.turns.filter((turn) => turn.judgment.verdict === "corrected");
}

/**
 * What `makeCandidates` does: answer the candidates already kept, answer none
 * for a talk without a corrected turn, or ask the model once. A talk still
 * open is `ERR_CONFLICT`: its end comes first.
 */
export function decideCandidates(
  talk: Talk | undefined,
): Result<
  | { readonly kind: "kept"; readonly cards: TalkCards }
  | { readonly kind: "none" }
  | { readonly kind: "ask"; readonly talk: Talk; readonly turns: readonly Turn[] },
  TalkError
> {
  if (talk === undefined) {
    return err({ code: "ERR_TALK_NOT_FOUND" });
  }
  if (talk.cards !== undefined) {
    return ok({ kind: "kept", cards: talk.cards });
  }
  if (talk.status === "open") {
    return err({ code: "ERR_CONFLICT" });
  }
  const turns = correctedTurns(talk);
  return ok(turns.length === 0 ? { kind: "none" } : { kind: "ask", talk, turns });
}

/**
 * The candidates worth keeping of what the model answered: each from a
 * corrected turn not yet taken, its text meeting the card rules, at most
 * `TALK_TUNING.maxCandidates`. One that breaks a rule is dropped, not the rest.
 */
export function pickCandidates(
  turns: readonly Turn[],
  answered: readonly CardCandidate[],
): CardCandidate[] {
  const open = new Set(turns.map((turn) => turn.n));
  const picked: CardCandidate[] = [];
  for (const candidate of answered) {
    if (open.has(candidate.turn) && fitsCardText(candidate)) {
      open.delete(candidate.turn);
      picked.push(candidate);
    }
  }
  return picked.slice(0, TALK_TUNING.maxCandidates);
}

/**
 * The id a candidate's personal card takes: drawn from the talk and the
 * candidate, so the same candidate always names the same card.
 */
export function personalCardId(talkId: string, index: number): string {
  const random = seededRandom(`card:${talkId}:${String(index)}`);
  const part = () =>
    Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0");
  return `p_${part()}${part()}`;
}

/** The card each normalized headword is answered as, and what a new personal card is made with. */
export interface AddCardsState {
  readonly talk: Talk | undefined;
  /** Normalized headword → card id: the catalog's cards first, then the learner's own. */
  readonly known: ReadonlyMap<string, string>;
  readonly progress: ReadonlyMap<string, VocabProgress>;
  readonly target: string;
  readonly l1: string;
  readonly level: number;
  readonly now: number;
}

/**
 * What adding the candidates at `indexes` writes. A candidate matched to a
 * card by its headword marks that card as from the talk — weak — added as new
 * or kept as it stands; any other becomes a personal card, new and weak. A
 * candidate already added is skipped, so adding it again writes nothing.
 */
export function decideAddCards(
  state: AddCardsState,
  indexes: readonly number[],
): Result<
  {
    readonly talk: Talk;
    /** The talk's candidates, with what this adds. */
    readonly offered: TalkCards;
    readonly progress: readonly VocabProgress[];
    readonly cards: readonly PersonalCard[];
  },
  TalkError
> {
  const { talk } = state;
  if (talk === undefined) {
    return err({ code: "ERR_TALK_NOT_FOUND" });
  }
  if (talk.cards === undefined) {
    return err({ code: "ERR_CONFLICT" });
  }
  const { candidates } = talk.cards;
  if (
    !indexes.every(
      (index) => Number.isInteger(index) && index >= 0 && index < candidates.length,
    )
  ) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const known = new Map(state.known);
  const added = [...talk.cards.added];
  const progress = new Map<string, VocabProgress>();
  const cards: PersonalCard[] = [];
  for (const index of indexes) {
    const candidate = candidates[index];
    if (candidate === undefined || added.some((entry) => entry.index === index))
      continue;
    const source = { kind: "talk", talkId: talk.id, turn: candidate.turn } as const;
    const headword = normalizeHeadword(candidate.headword);
    const cardId = known.get(headword) ?? personalCardId(talk.id, index);
    if (!known.has(headword)) {
      const { category, definition, example, example2, meaning } = candidate;
      cards.push({
        ...{ id: cardId, target: state.target, l1: state.l1, level: state.level },
        ...{ category, headword: candidate.headword, definition, example, example2 },
        ...{ meaning, source, createdAt: state.now },
      });
      known.set(headword, cardId);
    }
    const current = progress.get(cardId) ?? state.progress.get(cardId);
    progress.set(cardId, {
      cardId,
      source,
      state: current?.state ?? null,
      firstDay: current?.firstDay ?? null,
    });
    added.push({ index, cardId });
  }
  const unchanged = added.length === talk.cards.added.length;
  const offered = unchanged ? talk.cards : { ...talk.cards, added };
  return ok({
    talk: unchanged ? talk : { ...talk, cards: offered },
    offered,
    progress: [...progress.values()],
    cards,
  });
}
