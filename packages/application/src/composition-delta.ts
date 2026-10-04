import type { ItemProgress } from "@instant-composition/domain";
import type { CatalogSnapshot } from "./catalog";
import { accumulateComposition } from "./composition-aggregate";
import type { CompositionBuild, EvidenceCounts } from "./composition-model";

function numbers(
  current: Readonly<Record<string, number>>,
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const next = new Map(Object.entries(current));
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const value = (next.get(key) ?? 0) - (before[key] ?? 0) + (after[key] ?? 0);
    if (value === 0) next.delete(key);
    else next.set(key, value);
  }
  return Object.fromEntries(next);
}
function evidence(
  current: Readonly<Record<string, EvidenceCounts>>,
  before: Readonly<Record<string, EvidenceCounts>>,
  after: Readonly<Record<string, EvidenceCounts>>,
): Readonly<Record<string, EvidenceCounts>> {
  const next = new Map(Object.entries(current));
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const value = {
      seen:
        (next.get(key)?.seen ?? 0) - (before[key]?.seen ?? 0) + (after[key]?.seen ?? 0),
      misses:
        (next.get(key)?.misses ?? 0) -
        (before[key]?.misses ?? 0) +
        (after[key]?.misses ?? 0),
    };
    if (value.seen === 0) next.delete(key);
    else next.set(key, value);
  }
  return Object.fromEntries(next);
}
/** Subtracts one old item and adds its replacement; retained state has no lifetime item list. */
export function compositionDelta(
  build: CompositionBuild,
  before: ItemProgress | undefined,
  after: ItemProgress | undefined,
  snapshot: CatalogSnapshot,
  topics: readonly string[],
): CompositionBuild {
  const empty: CompositionBuild = {
    ...build,
    phase: "items",
    known: "0".repeat(build.known.length),
    concepts: {},
    subtopics: {},
    reach: {},
    breakdown: {},
    answered: 0,
    newAnswered: 0,
    due: 0,
    notDue: 0,
    pending: 0,
    notDueTop: [],
    conceptFirst: {},
    conceptRanks: {},
    notDueConceptFirst: {},
    notDueConceptRanks: {},
  };
  const old = accumulateComposition(
    empty,
    before === undefined ? [] : [before],
    snapshot,
    topics,
  );
  const next = accumulateComposition(
    empty,
    after === undefined ? [] : [after],
    snapshot,
    topics,
  );
  const id = after?.item.id ?? before?.item.id;
  const at = [...snapshot.shown.keys()].indexOf(id ?? "");
  const known =
    at < 0
      ? build.known
      : `${build.known.slice(0, at)}${after === undefined ? "0" : "1"}${build.known.slice(at + 1)}`;
  return {
    ...build,
    known,
    answered: build.answered - old.answered + next.answered,
    newAnswered: build.newAnswered - old.newAnswered + next.newAnswered,
    due: build.due - old.due + next.due,
    notDue: build.notDue - old.notDue + next.notDue,
    pending: build.pending - old.pending + next.pending,
    concepts: evidence(build.concepts, old.concepts, next.concepts),
    subtopics: evidence(build.subtopics, old.subtopics, next.subtopics),
    reach: numbers(build.reach, old.reach, next.reach),
    breakdown: numbers(build.breakdown, old.breakdown, next.breakdown),
  };
}
