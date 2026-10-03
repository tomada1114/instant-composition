import type { FsrsState } from "./fsrs";
import type { ReviewEntry } from "./records";
import type { CardState } from "./types";

/** A canonical schedule identity independent of object field order. */
function stateKey(memory: CardState | null, fsrs: FsrsState | null): string {
  return JSON.stringify([
    memory === null
      ? null
      : [memory.box, memory.lastDay, memory.dueDay, memory.seenCount],
    fsrs === null
      ? null
      : [
          fsrs.stability,
          fsrs.difficulty,
          fsrs.reps,
          fsrs.lapses,
          fsrs.lastDay,
          fsrs.dueDay,
        ],
  ]);
}

function keyOf(entry: ReviewEntry, side: "before" | "after"): string {
  return stateKey(entry[side], entry.fsrs?.[side] ?? null);
}

/** Re-asks and first passes that left the schedule unchanged do not move the projection. */
function moved(entry: ReviewEntry): boolean {
  if (entry.detail.pass !== "first") return false;
  if (entry.fsrs !== undefined) {
    return (
      entry.fsrs.after !== null &&
      entry.fsrs.after.reps !== (entry.fsrs.before?.reps ?? 0)
    );
  }
  return (
    entry.before === null ||
    entry.after === null ||
    keyOf(entry, "before") !== keyOf(entry, "after")
  );
}

/** Follows one unambiguous before/after chain, checking new revisions along the way. */
function chain(entries: readonly ReviewEntry[]): readonly ReviewEntry[] {
  const nextByState = new Map<string, ReviewEntry>();
  for (const entry of entries) {
    const before = keyOf(entry, "before");
    if (nextByState.has(before)) {
      throw new RangeError("Review history has more than one successor for a state.");
    }
    nextByState.set(before, entry);
  }
  const ordered: ReviewEntry[] = [];
  let current = stateKey(null, null);
  let revision = 0;
  while (nextByState.size > 0) {
    const entry = nextByState.get(current);
    if (entry === undefined) {
      throw new RangeError("Review history is disconnected from its preceding state.");
    }
    if (entry.fsrs === undefined && entry.after === null) {
      throw new RangeError("A state-changing review has no resulting schedule.");
    }
    if (entry.revision !== undefined) {
      if (!Number.isSafeInteger(entry.revision) || entry.revision !== revision + 1) {
        throw new RangeError("Review history has a non-consecutive item revision.");
      }
      revision = entry.revision;
    } else if (revision > 0) {
      throw new RangeError("A state-changing review is missing its item revision.");
    }
    ordered.push(entry);
    nextByState.delete(current);
    current = keyOf(entry, "after");
  }
  return ordered;
}

/** Causal state-changing reviews; malformed or ambiguous legacy histories fail closed. */
export function orderedMoves(log: readonly ReviewEntry[]): readonly ReviewEntry[] {
  const byItem = new Map<string, ReviewEntry[]>();
  for (const entry of log) {
    if (!moved(entry)) continue;
    const entries = byItem.get(entry.item.id) ?? [];
    entries.push(entry);
    byItem.set(entry.item.id, entries);
  }
  return [...byItem.values()].flatMap(chain);
}
