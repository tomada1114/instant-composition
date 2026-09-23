import { randomIndex, type Random } from "./random";
import { TUNING } from "./tuning";
import type { CardMeta, SubtopicRef } from "./types";

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

/**
 * `count` new cards split over the level and its two neighbours by
 * `TUNING.mix.levelShare`, the remainder going to the level itself; a band
 * that runs short is made up from the level first, then its neighbours.
 */
export function pickByLevel(
  pool: readonly CardMeta[],
  count: number,
  level: number,
  state: PickState,
): CardMeta[] {
  const { below, above } = TUNING.mix.levelShare;
  const belowCount = Math.floor(count * below);
  const aboveCount = Math.floor(count * above);
  const quotas: readonly (readonly [number, number])[] = [
    [level, count - belowCount - aboveCount],
    [level - 1, belowCount],
    [level + 1, aboveCount],
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
 * The focus share of the new cards: split between two focus subtopics, the
 * first taking the odd one, and either making up what the other lacks.
 */
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
  const picked: CardMeta[] = [];
  pools.forEach((focusPool, index) => {
    const share = Math.ceil((quota - picked.length) / (pools.length - index));
    picked.push(...pickByLevel(focusPool, share, level, state));
  });
  for (const focusPool of pools) {
    picked.push(...pickByLevel(focusPool, quota - picked.length, level, state));
  }
  return picked;
}
