import type { Commit } from "./store";

/** Two source items: eight ordinary answer writes + one epoch + eight candidate
 * replacements + four BUILD/STATE writes = at most twenty-one actions.
 * A card's one or two grammar tags change aggregate fields, not row cardinality.
 */
export const COMPOSITION_SOURCE_ITEMS_PER_COMMIT = 2;
export function changesComposition(commit: Commit): boolean {
  const relevant = (type: string): boolean =>
    ["item", "settings", "stats", "day", "portion"].includes(type);
  return (
    [...commit.puts, ...commit.updates.map(({ entry }) => entry)].some(({ type }) =>
      relevant(type),
    ) || (commit.deletes ?? []).some(({ key }) => relevant(key.type))
  );
}
export function compositionSourceIds(commit: Commit): ReadonlySet<string> {
  const ids = new Set(
    [...commit.puts, ...commit.updates.map(({ entry }) => entry)].flatMap((entry) =>
      entry.type === "item" ? [entry.value.item.id] : [],
    ),
  );
  for (const { key } of commit.deletes ?? [])
    if (key.type === "item") ids.add(key.item.id);
  if (ids.size > COMPOSITION_SOURCE_ITEMS_PER_COMMIT)
    throw new RangeError("A composition source transaction changes at most two items.");
  return ids;
}
