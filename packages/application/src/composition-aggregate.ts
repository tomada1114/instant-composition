import {
  dayDiff,
  retrievability,
  rankWeaknesses,
  type DayKey,
  type ItemProgress,
  type Weaknesses,
} from "@instant-composition/domain";
import { placeOf, type CatalogSnapshot } from "./catalog";
import type {
  CompositionBuild,
  EvidenceCounts,
  RankedCompositionCard,
} from "./composition-model";

export function compareCompositionCards(
  a: RankedCompositionCard,
  b: RankedCompositionCard,
): number {
  return (
    Number(b.scheduled) - Number(a.scheduled) ||
    a.recall - b.recall ||
    a.at - b.at ||
    a.id.localeCompare(b.id)
  );
}
export function rankedCompositionCard(
  item: ItemProgress,
  day: DayKey,
): RankedCompositionCard {
  return {
    id: item.item.id,
    scheduled: item.fsrs !== undefined,
    recall: item.fsrs === undefined ? 0 : retrievability(item.fsrs, day),
    at: item.last?.answeredAt ?? 0,
  };
}
function evidence(
  counts: Record<string, EvidenceCounts>,
  key: string,
  missed: boolean,
): void {
  const old = counts[key] ?? { seen: 0, misses: 0 };
  counts[key] = { seen: old.seen + 1, misses: old.misses + Number(missed) };
}
export function compositionWeaknesses(
  build: CompositionBuild,
  snapshot: CatalogSnapshot,
): Weaknesses {
  return rankWeaknesses({
    concepts: Object.entries(build.concepts).map(([concept, counts]) => ({
      concept,
      ...counts,
    })),
    subtopics: [
      ...new Map(
        [...snapshot.shown.values()].map((card) => [
          `${card.topic}/${card.subtopic}`,
          { topic: card.topic, subtopic: card.subtopic },
        ]),
      ).entries(),
    ].flatMap(([key, ref]) => {
      const counts = build.subtopics[key];
      return counts === undefined ? [] : [{ ...ref, ...counts }];
    }),
  });
}
/** The accumulator contains fixed catalog memberships, counters and five top-up candidates. */
export function accumulateComposition(
  build: CompositionBuild,
  items: readonly ItemProgress[],
  snapshot: CatalogSnapshot,
  topics: readonly string[],
): CompositionBuild {
  const cards = [...snapshot.shown.values()];
  const index = new Map(cards.map((card, at) => [card.id, at]));
  const known = Array.from({ length: build.known.length }, (_, at) =>
    build.known.charAt(at),
  );
  const concepts = { ...build.concepts };
  const subtopics = { ...build.subtopics };
  const reach = { ...build.reach };
  const breakdown = { ...build.breakdown };
  const conceptFirst = { ...build.conceptFirst };
  const notDueConceptFirst = { ...build.notDueConceptFirst };
  const notDueConceptRanks = { ...build.notDueConceptRanks };
  const conceptRanks = { ...build.conceptRanks };
  let { answered, newAnswered, due, notDue, pending } = build;
  let notDueTop = [...build.notDueTop];
  const place = placeOf(snapshot);
  const weak = compositionWeaknesses(build, snapshot).grammar.map(
    ({ concept }) => concept,
  );
  for (const item of items) {
    const card = snapshot.shown.get(item.item.id);
    const isAnswered = (item.fsrs?.lastDay ?? item.memory?.lastDay) === build.day;
    const inScope = card !== undefined && topics.includes(card.topic) && !isAnswered;
    const isDue = item.fsrs === undefined || dayDiff(item.fsrs.dueDay, build.day) >= 0;
    const ranked = rankedCompositionCard(item, build.day);
    if (build.phase === "ranks") {
      if (inScope && isDue)
        for (const concept of weak) {
          const first = conceptFirst[concept];
          if (first !== undefined && compareCompositionCards(ranked, first) < 0)
            conceptRanks[concept] = (conceptRanks[concept] ?? 0) + 1;
        }
      if (inScope && !isDue)
        for (const concept of weak) {
          const first = notDueConceptFirst[concept];
          if (
            first !== undefined &&
            (ranked.recall - first.recall || ranked.id.localeCompare(first.id)) < 0
          )
            notDueConceptRanks[concept] = (notDueConceptRanks[concept] ?? 0) + 1;
        }
      continue;
    }
    const at = index.get(item.item.id);
    if (at !== undefined) known[at] = "1";
    if (isAnswered) {
      answered += 1;
      newAnswered += Number(item.memory === undefined && item.fsrs?.reps === 1);
    }
    const ref = place(item.item.id) ?? item.placement;
    if (topics.includes(ref.topic)) {
      if (item.mastered !== null) {
        reach[ref.topic] = (reach[ref.topic] ?? 0) + 1;
        const key = `${ref.topic}/${ref.subtopic}`;
        if (
          snapshot.topics.some(
            (topic) =>
              topic.id === ref.topic &&
              topic.subtopics.some((sub) => sub.id === ref.subtopic),
          )
        )
          breakdown[key] = (breakdown[key] ?? 0) + 1;
      } else if (item.okDays.length === 1) pending += 1;
    }
    if (card !== undefined && item.last !== null) {
      const missed = item.last.result !== "ok";
      for (const concept of new Set(card.concepts))
        if (/^[^:]+:grammar\//u.test(concept)) evidence(concepts, concept, missed);
      evidence(subtopics, `${card.topic}/${card.subtopic}`, missed);
    }
    if (!inScope) continue;
    if (isDue) {
      due += 1;
      for (const concept of new Set(card.concepts)) {
        const first = conceptFirst[concept];
        if (
          /^[^:]+:grammar\//u.test(concept) &&
          (first === undefined || compareCompositionCards(ranked, first) < 0)
        )
          conceptFirst[concept] = ranked;
      }
    } else {
      notDue += 1;
      for (const concept of new Set(card.concepts)) {
        const first = notDueConceptFirst[concept];
        if (
          /^[^:]+:grammar\//u.test(concept) &&
          (first === undefined ||
            (ranked.recall - first.recall || ranked.id.localeCompare(first.id)) < 0)
        )
          notDueConceptFirst[concept] = ranked;
      }
      notDueTop = [...notDueTop, ranked]
        .sort((a, b) => a.recall - b.recall || a.id.localeCompare(b.id))
        .slice(0, 5);
    }
  }
  return {
    ...build,
    known: known.join(""),
    concepts,
    subtopics,
    reach,
    breakdown,
    pending,
    answered,
    newAnswered,
    due,
    notDue,
    notDueTop,
    conceptFirst,
    conceptRanks,
    notDueConceptFirst,
    notDueConceptRanks,
  };
}
