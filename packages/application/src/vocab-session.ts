import {
  dealVocab,
  ok,
  vocabFigures,
  type Result,
  type VocabSession,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps } from "./execute";
import { loadVocab, sessionViewOf } from "./vocab-load";
import type { VocabCategory } from "./vocab-item";
import type { VocabHub, VocabSessionView } from "./vocab-views";

/** A start, as the client sends it: the session id is the client's. */
export interface StartVocabSessionCommand {
  readonly sessionId: string;
  readonly kind: VocabSession["kind"];
  /** Restricts the deal to one category; absent, every category deals. */
  readonly category?: VocabCategory;
}

/**
 * The hub: today's reviews and new cards with the minutes they take, each
 * category's share of them, the weak cards and tomorrow's reviews. Nothing is
 * written, so a read on another day deals from that day's queue.
 */
export async function vocabHub(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<VocabHub, ApplicationError>> {
  const bound = storeFor(deps, context, "vocab");
  if (!bound.ok) {
    return bound;
  }
  const loaded = await loadVocab(bound.value, deps.catalog, context);
  if (!loaded.ok) {
    return loaded;
  }
  const figures = vocabFigures(loaded.value.state);
  return ok({
    empty: loaded.value.cards.size === 0,
    extra: dealVocab(loaded.value.state, "extra", null).length,
    today: { due: figures.due, new: figures.fresh, minutes: figures.minutes },
    categories: figures.categories.map(({ category, due, fresh, learning, total }) => ({
      category,
      extra: dealVocab(loaded.value.state, "extra", category).length,
      weak: dealVocab(loaded.value.state, "weak", category).length,
      due,
      new: fresh,
      learning,
      total,
    })),
    weak: figures.weak,
    tomorrow: figures.tomorrow,
  });
}

/**
 * Deals a session of the command's kind for today and keeps it, or answers
 * the session the id already names, so a retried start opens one session. A
 * session with nothing to deal is kept too, and answers no card.
 */
export async function startVocabSession(
  deps: ApplicationDeps,
  context: RequestContext,
  command: StartVocabSessionCommand,
): Promise<Result<VocabSessionView, ApplicationError>> {
  const bound = storeFor(deps, context, "startVocabSession");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed(store, async () => {
    const [loaded, existing] = await Promise.all([
      loadVocab(store, deps.catalog, context),
      store.vocabSession(command.sessionId),
    ]);
    if (!loaded.ok) {
      return loaded;
    }
    if (existing !== undefined) {
      return ok({ value: sessionViewOf(existing.value, loaded.value), writes: [] });
    }
    const category = command.category ?? null;
    const session: VocabSession = {
      id: command.sessionId,
      kind: command.kind,
      category,
      day: loaded.value.state.today,
      deck: dealVocab(loaded.value.state, command.kind, category).map(
        (card) => card.cardId,
      ),
      startedAt: context.now,
      finishedAt: null,
      tomorrow: null,
    };
    return ok({
      value: sessionViewOf(session, loaded.value),
      writes: [[{ type: "vocabSession", value: session }, undefined]],
    });
  });
}
