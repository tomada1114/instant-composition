import { adoptVocabPageEntries } from "./vocab-page-adoption";
import {
  decideVocabAnswers,
  err,
  ok,
  type Result,
  type VocabPagedAnswer,
} from "@instant-composition/domain";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps, type Write } from "./execute";
import {
  vocabPageMembership,
  validVocabPageProgress,
  vocabPageTextFits,
} from "./vocab-page-state";
import type { LearnerStore } from "./store";
import { loadVocabSubset, vocabSnapshots } from "./vocab-load";

export interface VocabPagedAnswersCommand {
  readonly sessionId: string;
  readonly generation: number;
  readonly answers: readonly VocabPagedAnswer[];
}

/** Reserves space for both prepared-day projections, membership and personal-card CAS. */
const PER_COMMIT = 2;

async function recordPageChunk(
  deps: ApplicationDeps,
  store: LearnerStore,
  context: RequestContext,
  command: VocabPagedAnswersCommand,
  chunk: readonly VocabPagedAnswer[],
): Promise<Result<undefined, ApplicationError>> {
  return committed(store, async () => {
    const existing = await store.vocabPagedSession(command.sessionId);
    if (existing === undefined) return err({ code: "ERR_SESSION_NOT_FOUND" });
    const session = existing.value;
    if (session.generation !== command.generation)
      return err({ code: "ERR_BAD_REQUEST" });
    if (session.status !== "ready") return err({ code: "ERR_READ_MODEL_NOT_READY" });
    const pageNumbers = [...new Set(command.answers.map((answer) => answer.page))];
    const [recorded, pages] = await Promise.all([
      store.vocabReviewsByIds(
        command.sessionId,
        command.answers.map((answer) => answer.id),
      ),
      Promise.all(
        pageNumbers.map((page) =>
          store.vocabDeckPage(command.sessionId, command.generation, page),
        ),
      ),
    ]);
    const decks = new Map(
      pages.flatMap((page) =>
        page === undefined ? [] : [[page.value.page, page.value] as const],
      ),
    );
    const membership = vocabPageMembership(
      session,
      command.answers,
      new Set(recorded.keys()),
      decks,
    );
    if (!membership.ok) return membership;
    const numbers = [
      ...new Set(
        chunk.filter((answer) => !recorded.has(answer.id)).map((answer) => answer.page),
      ),
    ];
    const checkpoints = await Promise.all(
      numbers.map((page) =>
        store.vocabPageProgress(command.sessionId, command.generation, page),
      ),
    );
    if (
      checkpoints.some((progress, index) => {
        const page = numbers[index];
        return !validVocabPageProgress(
          pages.find((deck) => deck?.value.page === page),
          progress,
        );
      })
    )
      return err({ code: "ERR_CONFLICT" });
    const held = new Map(
      checkpoints.flatMap((stored) =>
        stored === undefined ? [] : [[stored.value.page, stored] as const],
      ),
    );
    const loaded = await loadVocabSubset(
      store,
      deps.catalog,
      context,
      chunk.map((answer) => answer.cardId),
      session.day,
    );
    if (!loaded.ok) return loaded;
    if (!vocabPageTextFits(loaded.value.cards.values()))
      return err({ code: "ERR_CONTENT_UNREADABLE", reason: "malformed" });
    const decided = decideVocabAnswers(
      {
        session: {
          ...session,
          deck: [...decks.values()].flatMap((page) =>
            page.cards.map((card) => card.id),
          ),
        },
        progress: loaded.value.state.progress,
        recorded: new Set(recorded.keys()),
      },
      chunk,
      vocabSnapshots(loaded.value.cards),
      context.now,
    );
    if (!decided.ok) return decided;
    const { entries, moved } = decided.value;
    if (entries.length === 0) return ok({ value: undefined, writes: [] });
    const adopted = adoptVocabPageEntries(session, numbers, held, entries, chunk);
    if (!adopted.ok) return adopted;
    const writes: Write[] = [
      ...entries.map((value): Write => [{ type: "vocabReview", value }, undefined]),
      ...moved.map((value): Write => [
        { type: "vocabItem", value },
        loaded.value.items.get(value.cardId),
      ]),
      ...[...adopted.value.pages].map(([page, ids]): Write => [
        {
          type: "vocabPageProgress",
          value: {
            sessionId: command.sessionId,
            generation: command.generation,
            page,
            answered: [...ids],
          },
        },
        held.get(page),
      ]),
      [
        {
          type: "vocabPagedSession",
          value: adopted.value.session,
        },
        existing,
      ],
    ];
    const ids = [...new Set(entries.map((entry) => entry.cardId))];
    const changed = new Set(moved.map((entry) => entry.cardId));
    return ok({
      value: undefined,
      writes,
      expect: [
        ...numbers.map((page) => ({
          key: {
            type: "vocabDeckPage" as const,
            sessionId: session.id,
            generation: session.generation,
            page,
          },
          version: pages.find((deck) => deck?.value.page === page)?.version ?? null,
        })),
        ...ids
          .filter((id) => !changed.has(id))
          .map((cardId) => ({
            key: { type: "vocabItem" as const, cardId },
            version: loaded.value.items.get(cardId)?.version ?? null,
          })),
        ...ids.flatMap((id) => {
          const card = loaded.value.personal.get(id);
          return card === undefined
            ? []
            : [{ key: { type: "card" as const, id }, version: card.version }];
        }),
      ],
    });
  });
}
/** Each bounded chunk validates the whole bounded HTTP input before writing. */
export async function recordPagedVocabAnswers(
  deps: ApplicationDeps,
  context: RequestContext,
  command: VocabPagedAnswersCommand,
): Promise<Result<undefined, ApplicationError>> {
  const bound = storeFor(deps, context, "recordVocabAnswers");
  if (!bound.ok) return bound;
  if (command.answers.length > 60) return err({ code: "ERR_BAD_REQUEST" });
  for (let from = 0; from < Math.max(1, command.answers.length); from += PER_COMMIT) {
    const result = await recordPageChunk(
      deps,
      bound.value,
      context,
      command,
      command.answers.slice(from, from + PER_COMMIT),
    );
    if (!result.ok) return result;
  }
  return ok(undefined);
}
