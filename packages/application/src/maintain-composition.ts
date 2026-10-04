import { addDays, EMPTY_STATS, type ItemProgress } from "@instant-composition/domain";
import type { Catalog } from "./catalog";
import type { RequestContext } from "./context";
import { commitOf, todayOf, type Removal, type Write } from "./execute";
import type { LearnerStore, Stored } from "./store";
import { compositionCandidate, compositionCandidateId } from "./composition-candidate";
import { changesComposition, compositionSourceIds } from "./composition-mutation";
import { compositionDelta } from "./composition-delta";
import { compositionHeads } from "./composition-heads";
import { compositionSchemaSupported } from "./composition-model";
import { sameCompositionIdentity } from "./composition-maintenance";
import { compositionOverlay } from "./composition-overlay";
import { publishComposition } from "./composition-preview";

/** Ready current/next generations move in the same source transaction; cold/changed settings use independent maintenance. */
export function maintainedCompositionStore(
  store: LearnerStore,
  catalog: Catalog,
  context: RequestContext,
): LearnerStore {
  return {
    ...store,
    async commit(commit) {
      if (
        !changesComposition(commit) ||
        [...commit.puts, ...commit.updates.map(({ entry }) => entry)].some(
          ({ type }) => type === "settings",
        )
      )
        return await store.commit(commit);
      const snapshot = await catalog.snapshot();
      if (!snapshot.ok) return await store.commit(commit);
      const ids = compositionSourceIds(commit);
      const [source, settings, stats, items] = await Promise.all([
        store.compositionSource(),
        store.settings(),
        store.stats(),
        ids.size === 0
          ? Promise.resolve(new Map<string, Stored<ItemProgress>>())
          : store.itemsByIds([...ids]),
      ]);
      if (
        (source !== undefined && !compositionSchemaSupported(source.value)) ||
        (stats !== undefined && stats.value.streak?.schema !== 1)
      )
        return await store.commit(commit);
      const nextStats = compositionOverlay(commit, { type: "stats" }, stats);
      const writes: Write[] = [];
      const deletes: Removal[] = [];
      for (const day of [todayOf(context), addDays(todayOf(context), 1)]) {
        const [published, checkpoint, portion, tallies] = await Promise.all([
          store.compositionReadModel(day),
          store.compositionBuild(day),
          store.portion(day),
          store.days([day]),
        ]);
        const tally = tallies.get(day);
        const identity = {
          day,
          epoch: source?.value.epoch ?? 0,
          catalogVersion: snapshot.value.version,
          settingsVersion: settings?.version ?? null,
          statsVersion: stats?.version ?? null,
          portionVersion: portion?.version ?? null,
          tallyVersion: tally?.version ?? null,
        };
        if (
          published === undefined ||
          !compositionSchemaSupported(published.value) ||
          checkpoint === undefined ||
          !compositionSchemaSupported(checkpoint.value) ||
          checkpoint.value.phase !== "ranks" ||
          checkpoint.value.cursor !== null ||
          published.value.generation !== checkpoint.value.generation ||
          (published.value.expiresAt !== undefined &&
            published.value.expiresAt * 1000 <= context.now) ||
          !sameCompositionIdentity(published.value, identity) ||
          !sameCompositionIdentity(checkpoint.value, identity)
        )
          continue;
        let build = checkpoint.value;
        const before = [...ids].flatMap((id) => {
          const row = compositionCandidate(
            items.get(id)?.value,
            build,
            snapshot.value,
            settings?.value.topics ?? [],
          );
          return row === undefined ? [] : [row];
        });
        const after = [...ids].flatMap((id) => {
          const next = compositionOverlay(
            commit,
            { type: "item", item: { kind: "composition", id } },
            items.get(id),
          );
          build = compositionDelta(
            build,
            items.get(id)?.value,
            next?.value,
            snapshot.value,
            settings?.value.topics ?? [],
          );
          const row = compositionCandidate(
            next?.value,
            build,
            snapshot.value,
            settings?.value.topics ?? [],
          );
          return row === undefined ? [] : [row];
        });
        const kept = await store.compositionCandidatesByKeys(before);
        if (before.some((candidate) => !kept.has(compositionCandidateId(candidate))))
          continue;
        const nextPortion = compositionOverlay(
          commit,
          { type: "portion", day },
          portion,
        );
        const nextTally = compositionOverlay(commit, { type: "day", day }, tally);
        build = {
          ...build,
          epoch: identity.epoch + 1,
          statsVersion: nextStats?.version ?? null,
          portionVersion: nextPortion?.version ?? null,
          tallyVersion: nextTally?.version ?? null,
        };
        build = await compositionHeads(
          store,
          build,
          snapshot.value,
          settings?.value,
          nextStats?.value ?? EMPTY_STATS,
          nextPortion?.value.target,
          nextTally?.value.roundsStarted ?? 0,
          ids,
          after,
        );
        const wanted = new Map(
          after.map((candidate) => [compositionCandidateId(candidate), candidate]),
        );
        for (const candidate of before) {
          const id = compositionCandidateId(candidate);
          const held = kept.get(id);
          if (held !== undefined && !wanted.has(id))
            deletes.push({
              key: { type: "compositionCandidate", candidate },
              version: held.version,
            });
        }
        for (const [id, candidate] of wanted)
          writes.push([
            { type: "compositionCandidate", value: candidate },
            kept.get(id),
          ]);
        writes.push(
          [{ type: "compositionBuild", value: build }, checkpoint],
          [
            {
              type: "compositionReadModel",
              value: publishComposition(
                build,
                snapshot.value,
                settings?.value,
                nextStats?.value ?? EMPTY_STATS,
                nextPortion?.value.target,
                nextTally?.value.roundsStarted ?? 0,
              ),
            },
            published,
          ],
        );
      }
      const additional = commitOf(writes, deletes);
      return await store.commit({
        ...commit,
        compositionSourceVersion: source?.version ?? null,
        puts: [...commit.puts, ...additional.puts],
        updates: [...commit.updates, ...additional.updates],
        deletes: [...(commit.deletes ?? []), ...deletes],
      });
    },
  };
}
