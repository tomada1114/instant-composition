/** A source of floats in `[0, 1)`. */
export type Random = () => number;

/**
 * A deterministic generator seeded from a string (FNV-1a into mulberry32).
 *
 * @remarks
 * The same seed has to give the same deck, so the start screen's preview of a
 * round and the round "Start" then builds are the same cards.
 */
export function seededRandom(seed: string): Random {
  let state = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** An integer in `[0, max)`. */
export function randomIndex(random: Random, max: number): number {
  return Math.floor(random() * max);
}

/** A shuffled copy (Fisher–Yates). */
export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = randomIndex(random, index + 1);
    const held = copy[index];
    const moved = copy[other];
    if (held !== undefined && moved !== undefined) {
      copy[index] = moved;
      copy[other] = held;
    }
  }
  return copy;
}
