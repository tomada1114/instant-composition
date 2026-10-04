import {
  addDays,
  err,
  ok,
  type DayKey,
  type Result,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { commitOf, storeFor, todayOf, type ApplicationDeps } from "./execute";
import {
  READ_MODEL_PAGE_SIZE,
  readModelSchemaSupported,
  type ReadModelStep,
  type VocabReadModel,
} from "./read-model";
import {
  candidateRows,
  countVocabCard,
  emptyVocabCounts,
  projectionCard,
} from "./vocab-projection";

/** One resumable maintenance page; no foreground screen calls this operation. */
export async function rebuildVocabReadModel(
  deps: ApplicationDeps,
  context: RequestContext,
  day: DayKey = todayOf(context),
): Promise<Result<ReadModelStep, ApplicationError>> {
  const bound = storeFor(deps, context, "rebuildProjections");
  if (!bound.ok) return bound;
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) return snapshot;
  const store = bound.value;
  if (
    day !== todayOf(context) &&
    day !== addDays(todayOf(context), 1) &&
    (await store.vocabReadModelRequest(day)) === undefined
  )
    return err({ code: "ERR_BAD_REQUEST" });
  const [source, previous] = await Promise.all([
    store.readModelSource(),
    store.vocabReadModel(day),
  ]);
  const version = source?.version ?? 0;
  const current = previous?.value;
  const matches =
    current !== undefined &&
    readModelSchemaSupported(current) &&
    (current.expiresAt === undefined || current.expiresAt * 1_000 > context.now) &&
    current.catalog === snapshot.value.version &&
    current.sourceVersion === version;
  if (matches && current.status === "ready")
    return ok({ status: "ready", day, rows: 0 });
  const restarted = current !== undefined && !matches;
  let model: VocabReadModel = matches
    ? current
    : {
        schema: 1,
        expiresAt: Math.floor(context.now / 1_000) + 3 * 86_400,
        day,
        catalog: snapshot.value.version,
        generation: `${day}:${snapshot.value.version}:${String(version)}:${String((previous?.version ?? 0) + 1)}`,
        sourceVersion: version,
        status: "building",
        phase: "catalog",
        offset: 0,
        cursor: null,
        counts: emptyVocabCounts(),
      };
  const all = [...snapshot.value.vocab.keys()];
  const personal =
    model.phase === "personal" ? await store.personalCardPage(model.cursor) : undefined;
  const ids =
    personal === undefined
      ? all.slice(model.offset, model.offset + READ_MODEL_PAGE_SIZE)
      : personal.rows.map(({ value }) => value.id);
  const items = await store.vocabItemsByIds(ids);
  const candidates = ids.flatMap((id) => {
    const own = personal?.rows.find(({ value }) => value.id === id)?.value;
    const shown = projectionCard(snapshot.value, id, own);
    model = {
      ...model,
      counts: countVocabCard(model.counts, shown, items.get(id)?.value, day, 1),
    };
    return candidateRows(
      shown,
      items.get(id)?.value,
      day,
      model.generation,
      model.expiresAt,
    );
  });
  if (personal === undefined) {
    const offset = model.offset + ids.length;
    model = { ...model, offset, phase: offset >= all.length ? "personal" : "catalog" };
  } else {
    model = {
      ...model,
      cursor: personal.cursor,
      status: personal.cursor === null ? "ready" : "building",
    };
  }
  const result = await store.commit(
    commitOf(
      [
        ...candidates.map(
          (value) => [{ type: "vocabCandidate", value }, undefined] as const,
        ),
        [{ type: "vocabReadModel", value: model }, previous],
      ],
      [],
      [{ key: { type: "readModelSource" }, version: source?.version ?? null }],
    ),
  );
  return result.ok
    ? ok({ status: restarted ? "restarted" : model.status, day, rows: ids.length })
    : result;
}
