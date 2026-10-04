import type {
  VocabDeckPage,
  VocabPageProgress,
  VocabPagedSession,
  VocabPagedAnswer,
  VocabError,
  Result,
} from "@instant-composition/domain";
import { err, ok } from "@instant-composition/domain";
import type { Stored } from "./store";

/** Only the current session's published prefix can supply live membership. */
export function publishedVocabPage(session: VocabPagedSession, page: number): boolean {
  return Number.isSafeInteger(page) && page >= 0 && page < session.pages;
}

/** Adoption checkpoints contain only membership in their immutable bounded page. */
export function validVocabPageProgress(
  deck: Stored<VocabDeckPage> | undefined,
  progress: Stored<VocabPageProgress> | undefined,
): boolean {
  if (progress === undefined) return true;
  if (deck === undefined) return false;
  const expected = deck.value;
  const value = progress.value;
  const cards = new Set(expected.cards.map((card) => card.id));
  return (
    value.sessionId === expected.sessionId &&
    value.generation === expected.generation &&
    value.page === expected.page &&
    value.answered.every((id) => cards.has(id))
  );
}

/** Text admission is independent of membership and keeps each bounded response finite. */
export function vocabPageTextFits(
  cards: Iterable<{ readonly headword: string; readonly meaning: string }>,
): boolean {
  return [...cards].every(
    (card) =>
      JSON.stringify(card).length <= 4096 &&
      card.headword.length <= 2048 &&
      card.meaning.length <= 20,
  );
}

/** Validate the full bounded command before its first chunk can adopt an answer. */
export function vocabPageMembership(
  session: VocabPagedSession,
  answers: readonly VocabPagedAnswer[],
  recorded: ReadonlySet<string>,
  decks: ReadonlyMap<number, VocabDeckPage>,
): Result<undefined, VocabError> {
  const fresh = answers.filter((answer) => !recorded.has(answer.id));
  if (session.finishedAt !== null && fresh.length > 0)
    return err({ code: "ERR_SESSION_CLOSED" });
  if (
    fresh.some(
      (answer) =>
        !publishedVocabPage(session, answer.page) ||
        !decks.get(answer.page)?.cards.some((card) => card.id === answer.cardId),
    )
  )
    return err({ code: "ERR_BAD_REQUEST" });
  return ok(undefined);
}
