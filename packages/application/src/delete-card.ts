import { err, ok, type Result } from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps, type Removal } from "./execute";

/**
 * Deletes one of the learner's personal cards and its progress; the answers
 * logged for it stay. A catalog card is `ERR_CARD_NOT_PERSONAL`; an unknown
 * card, one already deleted or another learner's, `ERR_CARD_NOT_FOUND`.
 */
export async function deleteVocabCard(
  deps: ApplicationDeps,
  context: RequestContext,
  command: { readonly cardId: string },
): Promise<Result<undefined, ApplicationError>> {
  const bound = storeFor(deps, context, "deleteVocabCard");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed<undefined>(store, async () => {
    const [card, items] = await Promise.all([
      store.card(command.cardId),
      store.vocabItemsByIds([command.cardId]),
    ]);
    if (card === undefined) {
      const snapshot = await deps.catalog.snapshot();
      if (!snapshot.ok) {
        return snapshot;
      }
      return err({
        code: snapshot.value.vocab.has(command.cardId)
          ? "ERR_CARD_NOT_PERSONAL"
          : "ERR_CARD_NOT_FOUND",
      });
    }
    const progress = items.get(command.cardId);
    const deletes: Removal[] = [
      { key: { type: "card", id: command.cardId }, version: card.version },
      ...(progress === undefined
        ? []
        : [
            {
              key: { type: "vocabItem", cardId: command.cardId } as const,
              version: progress.version,
            },
          ]),
    ];
    return ok({
      value: undefined,
      writes: [],
      deletes,
      expect:
        progress === undefined
          ? [
              {
                key: { type: "vocabItem", cardId: command.cardId } as const,
                version: null,
              },
            ]
          : [],
    });
  });
}
