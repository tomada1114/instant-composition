import { randomIndex, type Random } from "./random";
import { TUNING } from "./tuning";
import type { CardMeta, ConceptId, SubtopicRef } from "./types";

/** Shared across one deck's picks, so the subtopic balance spans all of them. */
export interface PickState {
  readonly random: Random;
  readonly counts: Map<string, number>;
  readonly taken: Set<string>;
}

export function subtopicKey(card: SubtopicRef): string {
  return `${card.topic}/${card.subtopic}`;
}

/**
 * Up to `count` cards from `pool`, each from the subtopic picked least so far
 * (ties broken by the seeded generator), so one subtopic cannot crowd a deck.
 */
export function pickBalanced(
  pool: readonly CardMeta[],
  count: number,
  state: PickState,
): CardMeta[] {
  const picked: CardMeta[] = [];
  while (picked.length < count) {
    const open = pool.filter((card) => !state.taken.has(card.id));
    if (open.length === 0) {
      break;
    }
    const keys = [...new Set(open.map(subtopicKey))];
    const fewest = Math.min(...keys.map((key) => state.counts.get(key) ?? 0));
    const tied = keys.filter((key) => (state.counts.get(key) ?? 0) === fewest);
    const key = tied[randomIndex(state.random, tied.length)];
    const inKey = open.filter((candidate) => subtopicKey(candidate) === key);
    const card = inKey[randomIndex(state.random, inKey.length)];
    if (key === undefined || card === undefined) {
      break;
    }
    state.taken.add(card.id);
    state.counts.set(key, fewest + 1);
    picked.push(card);
  }
  return picked;
}

/** Whether a new card at `cardLevel` may be dealt at `level`: one below it up to the probe. */
export function inLevelBand(cardLevel: number, level: number): boolean {
  return cardLevel >= level - 1 && cardLevel <= level + TUNING.mix.probeStep;
}

/**
 * `count` new cards split over the level, its two neighbours and the probe
 * above them by `TUNING.mix.levelShare`, the remainder going to the level
 * itself; a band that runs short is made up from the level first, then its
 * neighbours, then the probe.
 */
export function pickByLevel(
  pool: readonly CardMeta[],
  count: number,
  level: number,
  state: PickState,
): CardMeta[] {
  const { below, above, probe } = TUNING.mix.levelShare;
  const belowCount = Math.floor(count * below);
  const aboveCount = Math.floor(count * above);
  const probeCount = Math.floor(count * probe);
  const quotas: readonly (readonly [number, number])[] = [
    [level, count - belowCount - aboveCount - probeCount],
    [level - 1, belowCount],
    [level + 1, aboveCount],
    [level + TUNING.mix.probeStep, probeCount],
  ];
  const atLevel = (target: number): CardMeta[] =>
    pool.filter((card) => card.level === target);

  const picked = quotas.flatMap(([target, quota]) =>
    pickBalanced(atLevel(target), quota, state),
  );
  for (const [target] of quotas) {
    const deficit = count - picked.length;
    if (deficit > 0) {
      picked.push(...pickBalanced(atLevel(target), deficit, state));
    }
  }
  return picked;
}

/**
 * `quota` cards split between `pools`, the first taking the odd one, and any
 * pool making up what another lacks.
 */
function pickShared(
  pools: readonly (readonly CardMeta[])[],
  quota: number,
  level: number,
  state: PickState,
): CardMeta[] {
  const picked: CardMeta[] = [];
  pools.forEach((pool, index) => {
    const share = Math.ceil((quota - picked.length) / (pools.length - index));
    picked.push(...pickByLevel(pool, share, level, state));
  });
  for (const pool of pools) {
    picked.push(...pickByLevel(pool, quota - picked.length, level, state));
  }
  return picked;
}

/** The focus share of the new cards, split between the focus subtopics. */
export function pickFocus(
  pool: readonly CardMeta[],
  focus: readonly SubtopicRef[],
  quota: number,
  level: number,
  state: PickState,
): CardMeta[] {
  const pools = focus.map((ref) =>
    pool.filter((card) => subtopicKey(card) === subtopicKey(ref)),
  );
  return pickShared(pools, quota, level, state);
}

/** The weak share of the new cards, split between the weak concepts, weakest first. */
export function pickWeak(
  pool: readonly CardMeta[],
  concepts: readonly ConceptId[],
  quota: number,
  level: number,
  state: PickState,
): CardMeta[] {
  const pools = concepts.map((concept) =>
    pool.filter((card) => card.concepts.includes(concept)),
  );
  return pickShared(pools, quota, level, state);
}
