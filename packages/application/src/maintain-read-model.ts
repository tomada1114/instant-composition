import { addDays } from "@instant-composition/domain";

import { nextReadModelValue } from "./read-model-mutation";
import type { Catalog } from "./catalog";
import type { RequestContext } from "./context";
import { dayOf } from "@instant-composition/domain";
import {
  readModelSchemaSupported,
  vocabCandidateId,
  type VocabCandidate,
} from "./read-model";
import type { Commit, Entry, LearnerStore } from "./store";
import { candidateRows, countVocabCard, projectionCard } from "./vocab-projection";

function sourceIds(commit: Commit): string[] {
  const written = [...commit.puts, ...commit.updates.map(({ entry }) => entry)];
  return [
    ...new Set([
      ...written.flatMap((entry) =>
        entry.type === "card"
          ? [entry.value.id]
          : entry.type === "vocabItem"
            ? [entry.value.cardId]
            : [],
      ),
      ...(commit.deletes ?? []).flatMap(({ key }) =>
        key.type === "card" ? [key.id] : key.type === "vocabItem" ? [key.cardId] : [],
      ),
    ]),
  ];
}

/** Updates prepared days and source records in one conditional commit. */
export function maintainedReadModelStore(
  store: LearnerStore,
  catalog: Catalog,
  context: RequestContext,
): LearnerStore {
  return {
    ...store,
    async commit(original) {
      const ids = sourceIds(original);
      if (ids.length === 0) return store.commit(original);
      const today = dayOf(
        context.now,
        context.learner.timeZone,
        context.learner.dayBoundaryHour,
      );
      const [snapshot, source, todayModel, tomorrowModel, cards, items] =
        await Promise.all([
          catalog.snapshot(),
          store.readModelSource(),
          store.vocabReadModel(today),
          store.vocabReadModel(addDays(today, 1)),
          store.cardsByIds(ids),
          store.vocabItemsByIds(ids),
        ]);
      if (!snapshot.ok) return store.commit(original);
      const sourceVersion = source?.version ?? 0;
      const ready = [todayModel, tomorrowModel].filter(
        (stored) =>
          stored?.value.status === "ready" &&
          (stored.value.expiresAt === undefined ||
            stored.value.expiresAt * 1_000 > context.now) &&
          readModelSchemaSupported(stored.value) &&
          stored.value.sourceVersion === sourceVersion &&
          stored.value.catalog === snapshot.value.version,
      );
      const puts: Entry[] = [...original.puts];
      const updates = [...original.updates];
      const deletes = [...(original.deletes ?? [])];
      const expect = [...original.expect];
      for (const stored of ready) {
        if (stored === undefined) continue;
        let counts = stored.value.counts;
        const before: VocabCandidate[] = [];
        const after: VocabCandidate[] = [];
        for (const id of ids) {
          const ownBefore = cards.get(id)?.value;
          const ownAfter = nextReadModelValue(original, id, "card", ownBefore);
          const progressBefore = items.get(id)?.value;
          const progressAfter = nextReadModelValue(
            original,
            id,
            "vocabItem",
            progressBefore,
          );
          const oldCard = projectionCard(snapshot.value, id, ownBefore);
          // Removing a personal card must not resurrect an unrelated catalog id.
          const newCard =
            ownBefore !== undefined && ownAfter === undefined
              ? undefined
              : projectionCard(snapshot.value, id, ownAfter);
          counts = countVocabCard(
            counts,
            oldCard,
            progressBefore,
            stored.value.day,
            -1,
          );
          counts = countVocabCard(counts, newCard, progressAfter, stored.value.day, 1);
          before.push(
            ...candidateRows(
              oldCard,
              progressBefore,
              stored.value.day,
              stored.value.generation,
              stored.value.expiresAt,
            ),
          );
          after.push(
            ...candidateRows(
              newCard,
              progressAfter,
              stored.value.day,
              stored.value.generation,
              stored.value.expiresAt,
            ),
          );
        }
        const known = await store.vocabCandidatesByKeys([...before, ...after]);
        const next = new Map(
          after.map((candidate) => [vocabCandidateId(candidate), candidate]),
        );
        for (const old of before) {
          const identity = vocabCandidateId(old);
          if (next.has(identity)) continue;
          const row = known.get(identity);
          if (row !== undefined)
            deletes.push({
              key: { type: "vocabCandidate", candidate: old },
              version: row.version,
            });
        }
        for (const candidate of next.values()) {
          const entry = { type: "vocabCandidate", value: candidate } as const;
          const row = known.get(vocabCandidateId(candidate));
          if (row === undefined) puts.push(entry);
          else updates.push({ entry, version: row.version });
        }
        updates.push({
          entry: {
            type: "vocabReadModel",
            value: { ...stored.value, counts, sourceVersion: sourceVersion + 1 },
          },
          version: stored.version,
        });
      }
      for (const id of ids) {
        const alreadyGuarded = (type: "card" | "vocabItem"): boolean =>
          [...puts, ...updates.map(({ entry }) => entry)].some(
            (entry) =>
              entry.type === type &&
              (entry.type === "card" ? entry.value.id : entry.value.cardId) === id,
          ) ||
          [...expect, ...deletes].some(
            ({ key }) =>
              key.type === type && (key.type === "card" ? key.id : key.cardId) === id,
          );
        if (!alreadyGuarded("card"))
          expect.push({
            key: { type: "card", id },
            version: cards.get(id)?.version ?? null,
          });
        if (!alreadyGuarded("vocabItem"))
          expect.push({
            key: { type: "vocabItem", cardId: id },
            version: items.get(id)?.version ?? null,
          });
      }
      return store.commit({
        ...original,
        puts,
        updates,
        deletes,
        expect,
        readModelSourceVersion: source?.version ?? null,
      });
    },
  };
}
