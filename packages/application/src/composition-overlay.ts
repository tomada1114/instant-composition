import { keyOf, type Commit, type Entry, type Key, type Stored } from "./store";

type ValueOf<T extends Entry["type"]> = Extract<Entry, { readonly type: T }>["value"];
/** The value/version a conditional mutation will publish, without mutating its read snapshot. */
export function compositionOverlay<T extends Entry["type"]>(
  commit: Commit,
  key: Key & { readonly type: T },
  previous: Stored<ValueOf<T>> | undefined,
): Stored<ValueOf<T>> | undefined {
  const same = (candidate: Key): boolean =>
    JSON.stringify(candidate) === JSON.stringify(key);
  const put = commit.puts.find((entry) => same(keyOf(entry)));
  if (put !== undefined) return { value: put.value as ValueOf<T>, version: 1 };
  const update = commit.updates.find(({ entry }) => same(keyOf(entry)));
  if (update !== undefined)
    return { value: update.entry.value as ValueOf<T>, version: update.version + 1 };
  return (commit.deletes ?? []).some(({ key: candidate }) => same(candidate))
    ? undefined
    : previous;
}
