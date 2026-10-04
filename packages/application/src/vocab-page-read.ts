import { err, ok, type Result } from "@instant-composition/domain";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor, type ApplicationDeps } from "./execute";
import { loadVocabSubset, cardViewOf } from "./vocab-load";
import {
  publishedVocabPage,
  validVocabPageProgress,
  vocabPageTextFits,
} from "./vocab-page-state";
import type { VocabPageView } from "./vocab-page-views";

/** A stable cursor refers only to this learner's session generation and page. */
export async function getPagedVocabPage(
  deps: ApplicationDeps,
  context: RequestContext,
  command: {
    readonly sessionId: string;
    readonly cursor: string | null;
    readonly retained?: readonly { readonly page: number; readonly cardId: string }[];
  },
): Promise<Result<VocabPageView, ApplicationError>> {
  const bound = storeFor(deps, context, "vocab");
  if (!bound.ok) return bound;
  const store = bound.value;
  const existing = await store.vocabPagedSession(command.sessionId);
  if (existing === undefined) return err({ code: "ERR_SESSION_NOT_FOUND" });
  const session = existing.value;
  if (session.status !== "ready") return err({ code: "ERR_READ_MODEL_NOT_READY" });
  const parts = command.cursor?.split(":").map(Number);
  const generation = parts?.[0] ?? session.generation;
  const page = parts?.[1] ?? 0;
  if (
    generation !== session.generation ||
    !Number.isSafeInteger(page) ||
    page < 0 ||
    (command.cursor !== null && !/^\d+:\d+$/.test(command.cursor)) ||
    page >= Math.max(1, session.pages)
  )
    return err({ code: "ERR_BAD_REQUEST" });
  if (
    (command.retained?.length ?? 0) > 16 ||
    command.retained?.some((entry) => !publishedVocabPage(session, entry.page))
  )
    return err({ code: "ERR_BAD_REQUEST" });
  const [deck, progress, retainedPages] = await Promise.all([
    store.vocabDeckPage(session.id, generation, page),
    store.vocabPageProgress(session.id, generation, page),
    Promise.all(
      [...new Set(command.retained?.map((entry) => entry.page) ?? [])].map((number) =>
        store.vocabDeckPage(session.id, generation, number),
      ),
    ),
  ]);
  if (deck === undefined && session.pages !== 0) return err({ code: "ERR_CONFLICT" });
  if (!validVocabPageProgress(deck, progress)) return err({ code: "ERR_CONFLICT" });
  const retainedDecks = new Map(
    retainedPages.flatMap((entry) =>
      entry === undefined ? [] : [[entry.value.page, entry.value] as const],
    ),
  );
  const retainedIds = (command.retained ?? []).filter((entry) =>
    retainedDecks.get(entry.page)?.cards.some((card) => card.id === entry.cardId),
  );
  if (retainedIds.length !== (command.retained?.length ?? 0))
    return err({ code: "ERR_BAD_REQUEST" });
  const loaded = await loadVocabSubset(
    store,
    deps.catalog,
    context,
    [
      ...(deck?.value.cards.map((card) => card.id) ?? []),
      ...retainedIds.map((entry) => entry.cardId),
    ],
    session.day,
  );
  if (!loaded.ok) return loaded;
  const cards = (deck?.value.cards ?? []).flatMap(({ id, isNew }, slot) => {
    const shown = loaded.value.cards.get(id);
    return shown === undefined
      ? []
      : [
          {
            ...cardViewOf(shown, loaded.value.state.progress.get(id), session.day),
            isNew,
            slot,
          },
        ];
  });
  const retained = retainedIds.flatMap((entry) => {
    const shown = loaded.value.cards.get(entry.cardId);
    const slot =
      retainedDecks
        .get(entry.page)
        ?.cards.findIndex((card) => card.id === entry.cardId) ?? -1;
    const kept = retainedDecks.get(entry.page)?.cards[slot];
    return shown === undefined || kept === undefined
      ? []
      : [
          {
            ...cardViewOf(
              shown,
              loaded.value.state.progress.get(entry.cardId),
              session.day,
            ),
            isNew: kept.isNew,
            page: entry.page,
            slot,
          },
        ];
  });
  // A malformed text must never turn a bounded card count into an unbounded body.
  if (!vocabPageTextFits([...cards, ...retained]))
    return err({ code: "ERR_CONTENT_UNREADABLE", reason: "malformed" });
  const current = await store.vocabPagedSession(session.id);
  if (current?.value.generation !== generation || current.value.status !== "ready")
    return err({ code: "ERR_CONFLICT" });
  return ok({
    sessionId: session.id,
    kind: session.kind,
    category: session.category,
    day: session.day,
    generation,
    page,
    cards,
    retained,
    total: session.total,
    answered: progress?.value.answered ?? [],
    continuation:
      page + 1 < session.pages ? `${String(generation)}:${String(page + 1)}` : null,
  });
}
