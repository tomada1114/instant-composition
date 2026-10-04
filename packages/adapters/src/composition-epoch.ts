import type {
  Commit,
  CompositionSource,
  Entry,
  Stored,
} from "@instant-composition/application";
import { compositionSchemaSupported } from "@instant-composition/application";

import { compactStats } from "@instant-composition/domain";

export function compactCompositionStats(commit: Commit): Commit {
  const compact = (entry: Entry): Entry => {
    if (entry.type !== "stats" || entry.value.streak === undefined) return entry;
    if (!compositionSchemaSupported(entry.value.streak))
      throw new TypeError("Unsupported compact statistics schema.");
    return { ...entry, value: compactStats(entry.value, entry.value.streak.longest) };
  };
  return {
    ...commit,
    puts: commit.puts.map(compact),
    updates: commit.updates.map((update) => ({
      ...update,
      entry: compact(update.entry),
    })),
  };
}

export function changesComposition(commit: Commit): boolean {
  const relevant = (type: Entry["type"]): boolean =>
    ["item", "settings", "stats", "day", "portion"].includes(type);
  return (
    commit.puts.some((entry) => relevant(entry.type)) ||
    commit.updates.some(({ entry }) => relevant(entry.type)) ||
    (commit.deletes ?? []).some(({ key }) => relevant(key.type))
  );
}
export function compositionSourceMatches(
  commit: Commit,
  source: Stored<CompositionSource> | undefined,
): boolean {
  return (
    !Object.hasOwn(commit, "compositionSourceVersion") ||
    commit.compositionSourceVersion === (source?.version ?? null)
  );
}
export function withCompositionEpoch(
  commit: Commit,
  source: Stored<CompositionSource> | undefined,
): Commit {
  if (
    [...commit.puts, ...commit.updates.map(({ entry }) => entry)].some(
      (entry) => entry.type === "compositionSource",
    )
  )
    throw new RangeError(
      "Composition sources and their reserved epoch use separate restore commits.",
    );
  if (source !== undefined && !compositionSchemaSupported(source.value))
    throw new TypeError("Unsupported composition source schema.");
  const entry: Entry = {
    type: "compositionSource",
    value: { schema: 1, epoch: (source?.value.epoch ?? 0) + 1 },
  };
  return source === undefined
    ? { ...commit, puts: [...commit.puts, entry] }
    : { ...commit, updates: [...commit.updates, { entry, version: source.version }] };
}
