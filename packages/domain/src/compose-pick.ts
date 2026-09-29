import { randomIndex, type Random } from "./random";
import { TUNING } from "./tuning";
import type { CardMeta, ConceptId, SubtopicRef } from "./types";

/** Shared across one deck's picks, so the subtopic balance and the level plan span all of them. */
export interface PickState {
  readonly random: Random;
  readonly counts: Map<string, number>;
  readonly taken: Set<string>;
  /** New cards still planned per card level; see `levelPlan`. */
  readonly plan: Map<number, number>;
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

/** The bands with their shares, in the order a tie in the plan goes. */
function bands(level: number): readonly (readonly [number, number])[] {
  const { same, above, probe, below } = TUNING.mix.levelShare;
  return [
    [level, same],
    [level + 1, above],
    [level + TUNING.mix.probeStep, probe],
    [level - 1, below],
  ];
}

/**
 * How a deck's `count` new cards split over the card levels: by
 * `TUNING.mix.levelShare`, largest remainder first, then at least one card a
 * level up and one probe once `TUNING.mix.offLevelFrom` new cards allow them,
 * taken from the level below first. Planned over the whole deck, not per
 * share of it, so a few new cards beside the reviews still reach above.
 */
export function levelPlan(count: number, level: number): Map<number, number> {
  const shares = bands(level);
  const plan = new Map(
    shares.map(([band, share]) => [band, Math.floor(count * share)]),
  );
  const left = count - [...plan.values()].reduce((sum, planned) => sum + planned, 0);
  const byRemainder = shares
    .map(([band, share], index) => ({ band, index, rest: (count * share) % 1 }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { band } of byRemainder.slice(0, left)) {
    plan.set(band, (plan.get(band) ?? 0) + 1);
  }
  const { above, probe } = TUNING.mix.offLevelFrom;
  const floors: readonly (readonly [number, number])[] = [
    [level + 1, above],
    [level + TUNING.mix.probeStep, probe],
  ];
  for (const [band, from] of floors) {
    const donor = [level - 1, level].find((other) => (plan.get(other) ?? 0) > 0);
    if (count >= from && plan.get(band) === 0 && donor !== undefined) {
      plan.set(donor, (plan.get(donor) ?? 0) - 1);
      plan.set(band, 1);
    }
  }
  return plan;
}

/**
 * Up to `count` new cards from `pool`, each from the band with the most of
 * `state.plan` left; once the plan has no band `pool` can serve, the level
 * first, then its neighbours, then the probe.
 */
export function pickByLevel(
  pool: readonly CardMeta[],
  count: number,
  level: number,
  state: PickState,
): CardMeta[] {
  const makeUp = [level, level - 1, level + 1, level + TUNING.mix.probeStep];
  const atLevel = (target: number): CardMeta[] =>
    pool.filter((card) => card.level === target && !state.taken.has(card.id));
  const planned = (band: number): number => state.plan.get(band) ?? 0;
  const picked: CardMeta[] = [];
  while (picked.length < count) {
    const open = bands(level)
      .map(([band]) => band)
      .filter((band) => atLevel(band).length > 0);
    const band =
      open.reduce<number | undefined>(
        (best, next) =>
          planned(next) > (best === undefined ? 0 : planned(best)) ? next : best,
        undefined,
      ) ?? makeUp.find((next) => open.includes(next));
    const [card] = band === undefined ? [] : pickBalanced(atLevel(band), 1, state);
    if (band === undefined || card === undefined) {
      break;
    }
    state.plan.set(band, planned(band) - 1);
    picked.push(card);
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
