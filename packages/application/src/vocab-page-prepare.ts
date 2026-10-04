import {
  err,
  ok,
  VOCAB_PAGE_SIZE,
  vocabFreshPosition,
  type Result,
} from "@instant-composition/domain";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps } from "./execute";
import { loadVocabSubset } from "./vocab-load";
import { planPagedVocab } from "./vocab-page-plan";
import { preparationOf, type VocabPreparation } from "./vocab-page-views";

export { startPagedVocabSession } from "./vocab-page-start";

/** At most 64 global queue positions are copied; source races restart before any study. */
export async function preparePagedVocabSession(
  deps: ApplicationDeps,
  context: RequestContext,
  sessionId: string,
): Promise<Result<VocabPreparation, ApplicationError>> {
  const bound = storeFor(deps, context, "startVocabSession");
  if (!bound.ok) return bound;
  const store = bound.value;
  return committed(store, async () => {
    const existing = await store.vocabPagedSession(sessionId);
    if (existing === undefined) return err({ code: "ERR_SESSION_NOT_FOUND" });
    const session = existing.value;
    if (session.status === "ready")
      return ok({ value: preparationOf(session), writes: [] });
    const [source, model, settings, stats, snapshot] = await Promise.all([
      store.readModelSource(),
      store.vocabReadModel(session.day),
      store.settings(),
      store.stats(),
      deps.catalog.snapshot(),
    ]);
    if (!snapshot.ok) return snapshot;
    if (
      (source?.version ?? 0) !== session.sourceVersion ||
      model?.version !== session.modelVersion ||
      model.value.catalog !== session.catalog ||
      model.value.sourceVersion !== session.sourceVersion ||
      model.value.generation !== session.candidateGeneration ||
      model.value.status !== "ready" ||
      (model.value.expiresAt !== undefined &&
        model.value.expiresAt * 1000 <= context.now) ||
      (settings?.version ?? null) !== session.settingsVersion ||
      (stats?.version ?? null) !== session.statsVersion ||
      snapshot.value.version !== session.catalog
    ) {
      const plan = await planPagedVocab(
        store,
        deps,
        context,
        {
          sessionId,
          kind: session.kind,
          ...(session.category === null ? {} : { category: session.category }),
        },
        session,
      );
      return plan.ok
        ? ok({
            value: preparationOf(plan.value.session),
            writes: [
              [{ type: "vocabPagedSession", value: plan.value.session }, existing],
            ],
            expect: plan.value.expect,
          })
        : plan;
    }
    const start = session.dueRead + session.freshRead;
    if (
      ![
        start,
        start + VOCAB_PAGE_SIZE,
        session.dueCount + session.fresh.length,
        session.pages + 1,
      ].every(Number.isSafeInteger)
    )
      return err({ code: "ERR_CONFLICT" });
    const end = Math.min(
      start + VOCAB_PAGE_SIZE,
      session.dueCount + session.fresh.length,
    );
    const positions = new Map(
      session.fresh.map((id, index) => [
        vocabFreshPosition(index, session.dueCount, session.fresh.length),
        id,
      ]),
    );
    const freshPositions = [...positions].filter(
      ([position]) => position >= start && position < end,
    );
    const dueSize = end - start - freshPositions.length;
    const page =
      dueSize === 0
        ? { rows: [], cursor: session.dueCursor }
        : await store.vocabCandidates({
            day: session.day,
            generation: session.candidateGeneration,
            mode: "due",
            category: null,
            level: null,
            cursor: session.dueCursor,
            limit: dueSize,
          });
    if (page.rows.length !== dueSize) return err({ code: "ERR_CONFLICT" });
    let dueIndex = 0;
    const ids = Array.from({ length: end - start }, (_, index) => {
      const fresh = positions.get(start + index);
      return fresh ?? page.rows[dueIndex++]?.value.cardId;
    }).flatMap((id) => id ?? []);
    const loaded = await loadVocabSubset(
      store,
      deps.catalog,
      context,
      ids,
      session.day,
    );
    if (!loaded.ok) return loaded;
    if (loaded.value.snapshot.version !== session.catalog)
      return err({ code: "ERR_CONFLICT" });
    const cards = ids.flatMap((id) => {
      const card = loaded.value.cards.get(id);
      return card === undefined ||
        (session.category !== null && card.category !== session.category)
        ? []
        : [
            {
              id,
              isNew: (loaded.value.state.progress.get(id)?.state ?? null) === null,
            },
          ];
    });
    const next = {
      ...session,
      dueRead: session.dueRead + dueSize,
      freshRead: session.freshRead + freshPositions.length,
      dueCursor: page.cursor,
      pages: session.pages + 1,
      fresh: end === session.dueCount + session.fresh.length ? [] : session.fresh,
      status:
        end === session.dueCount + session.fresh.length
          ? ("ready" as const)
          : ("building" as const),
    };
    return ok({
      value: preparationOf(next),
      writes: [
        [
          {
            type: "vocabDeckPage",
            value: {
              sessionId,
              generation: session.generation,
              page: session.pages,
              cards,
            },
          },
          undefined,
        ],
        [{ type: "vocabPagedSession", value: next }, existing],
      ],
      expect: [
        { key: { type: "readModelSource" }, version: source?.version ?? null },
        {
          key: { type: "vocabReadModel", day: session.day },
          version: session.modelVersion,
        },
        { key: { type: "settings" }, version: session.settingsVersion },
        { key: { type: "stats" }, version: session.statsVersion },
      ],
    });
  });
}
