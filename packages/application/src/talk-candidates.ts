import {
  decideAddCards,
  decideCandidates,
  err,
  liveTalk,
  ok,
  type PersonalCard,
  type Result,
  type TalkCards,
} from "@instant-composition/domain";

import type { Catalog } from "./catalog";
import type { RequestContext } from "./context";
import type { TalkCommandError } from "./errors";
import { committed, storeFor, type Write } from "./execute";
import type { Stored } from "./store";
import { viewOf, vocabularyOf } from "./talk-candidate-view";
import { cardsRequest } from "./talk-cards";
import { ask, TALK_PROMPTS, type TalkDeps } from "./talk-model";
import type { CardCandidates } from "./talk-views";
import { knownHeadwords, shownCards } from "./vocab-shown";

/** What the candidate commands are handed: the talk's, and the catalog to match against. */
export interface CardDeps extends TalkDeps {
  readonly catalog: Catalog;
}

/** A pick of a talk's candidates, by their indexes. */
export interface AddCardsCommand {
  readonly talkId: string;
  readonly candidates: readonly number[];
}

/**
 * The card candidates at a kept talk's end: one `talk-cards` call over its
 * corrected turns, its answer kept on the talk so a resend answers it without
 * another. A talk with no corrected turn answers none, and calls nothing.
 */
export async function makeCandidates(
  deps: CardDeps,
  context: RequestContext,
  command: { readonly talkId: string },
): Promise<Result<CardCandidates, TalkCommandError>> {
  const bound = storeFor(deps, context, "makeCandidates");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  const read = async () => {
    const stored = await store.talk(command.talkId);
    return { stored, decided: decideCandidates(liveTalk(stored?.value, context.now)) };
  };
  const { decided } = await read();
  if (!decided.ok) {
    return decided;
  }
  if (decided.value.kind === "none") {
    return ok({ candidates: [] });
  }
  if (decided.value.kind === "kept") {
    return ok(viewOf(decided.value.cards, await vocabularyOf(store, snapshot.value)));
  }
  const reply = await ask(deps, cardsRequest(decided.value.turns));
  if (!reply.ok) {
    return err(reply.error);
  }
  const offered: TalkCards = {
    promptVersion: TALK_PROMPTS["talk-cards"],
    candidates: reply.value.value,
    added: [],
  };
  return committed(store, async () => {
    const { stored, decided: again } = await read();
    if (!again.ok) {
      return again;
    }
    const vocabulary = await vocabularyOf(store, snapshot.value);
    if (again.value.kind !== "ask") {
      const kept = again.value.kind === "kept" ? again.value.cards : undefined;
      return ok({
        value: kept === undefined ? { candidates: [] } : viewOf(kept, vocabulary),
        writes: [],
      });
    }
    const talk = { ...again.value.talk, cards: offered };
    return ok({
      value: viewOf(offered, vocabulary),
      writes: [[{ type: "talk", value: talk }, stored]],
    });
  });
}

/**
 * Adds the picked candidates to the learner's vocabulary: a match marked as
 * from the talk, any other made a personal card, each new one first in the
 * new quota. A candidate already added is not added again.
 */
export async function addCards(
  deps: CardDeps,
  context: RequestContext,
  command: AddCardsCommand,
): Promise<Result<CardCandidates, TalkCommandError>> {
  const bound = storeFor(deps, context, "addCards");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  const { target, l1 } = snapshot.value;
  return committed(store, async () => {
    const [stored, stats, personal, items] = await Promise.all([
      store.talk(command.talkId),
      store.stats(),
      store.cards(),
      store.vocabItems(),
    ]);
    const cards = shownCards(snapshot.value, personal);
    const decided = decideAddCards(
      {
        talk: liveTalk(stored?.value, context.now),
        known: knownHeadwords(cards),
        progress: new Map([...items].map(([id, item]) => [id, item.value])),
        ...{ target, l1, level: stats?.value.level?.level ?? 1, now: context.now },
      },
      command.candidates,
    );
    if (!decided.ok) {
      return decided;
    }
    const { talk, offered, progress, cards: made } = decided.value;
    const writes: Write[] = [
      ...(talk === stored?.value
        ? []
        : [[{ type: "talk", value: talk }, stored] as const]),
      ...made.map((value): Write => [{ type: "card", value }, undefined]),
      ...progress.map((value): Write => [
        { type: "vocabItem", value },
        items.get(value.cardId),
      ]),
    ];
    const own = new Map<string, Stored<PersonalCard>>(personal);
    for (const value of made) own.set(value.id, { value, version: 0 });
    const moved = new Map([...items].map(([id, item]) => [id, item.value]));
    for (const value of progress) moved.set(value.cardId, value);
    return ok({
      value: viewOf(offered, {
        cards: shownCards(snapshot.value, own),
        progress: moved,
      }),
      writes,
    });
  });
}
