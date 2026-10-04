import type { PersonalCard, VocabProgress } from "@instant-composition/domain";
import type { Commit } from "./store";

export function nextReadModelValue<T extends PersonalCard | VocabProgress>(
  commit: Commit,
  id: string,
  type: "card" | "vocabItem",
  previous: T | undefined,
): T | undefined {
  const written = [...commit.puts, ...commit.updates.map(({ entry }) => entry)];
  const entry = written.find(
    (entry) =>
      entry.type === type &&
      (entry.type === "card" ? entry.value.id : entry.value.cardId) === id,
  );
  if (entry?.type === "card" || entry?.type === "vocabItem") return entry.value as T;
  const removed = (commit.deletes ?? []).some(
    ({ key }) =>
      key.type === type && (key.type === "card" ? key.id : key.cardId) === id,
  );
  return removed ? undefined : previous;
}
