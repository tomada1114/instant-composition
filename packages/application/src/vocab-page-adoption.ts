import {
  err,
  ok,
  VOCAB_AGAIN_PREVIEW,
  type Result,
  type VocabPagedAnswer,
  type VocabPagedSession,
  type VocabPageProgress,
  type VocabReview,
} from "@instant-composition/domain";
import type { Stored } from "./store";

interface Adoption {
  readonly session: VocabPagedSession;
  readonly pages: ReadonlyMap<number, ReadonlySet<string>>;
}

/** First adoption updates only the pages this bounded chunk can change. */
export function adoptVocabPageEntries(
  session: VocabPagedSession,
  pages: readonly number[],
  held: ReadonlyMap<number, Stored<VocabPageProgress>>,
  entries: readonly VocabReview[],
  chunk: readonly VocabPagedAnswer[],
): Result<Adoption, { readonly code: "ERR_CONFLICT" }> {
  const adopted = new Map(
    pages.map((page) => [page, new Set(held.get(page)?.value.answered ?? [])]),
  );
  let answered = session.answered;
  let introduced = session.introduced;
  let againCount = session.againCount;
  const again = [...session.again];
  for (const entry of entries) {
    const input = chunk.find((answer) => answer.id === entry.id);
    const seen = input === undefined ? undefined : adopted.get(input.page);
    if (entry.pass !== "first" || seen === undefined || seen.has(entry.cardId))
      continue;
    seen.add(entry.cardId);
    answered += 1;
    introduced += Number(entry.before === null && entry.after !== null);
    if (entry.grade === "again") {
      againCount += 1;
      if (again.length < VOCAB_AGAIN_PREVIEW)
        again.push({ cardId: entry.cardId, ...entry.snapshot });
    }
  }
  if (![answered, introduced, againCount].every(Number.isSafeInteger))
    return err({ code: "ERR_CONFLICT" });
  return ok({
    pages: adopted,
    session: { ...session, answered, introduced, againCount, again },
  });
}
