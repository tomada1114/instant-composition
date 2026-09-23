import type { NotEnoughCards } from "./compose";
import { randomIndex, seededRandom } from "./random";
import { err, ok, type Result } from "./result";
import { TUNING } from "./tuning";
import type { AnswerResult, CardMeta } from "./types";

const MAX_LEVEL = 10;

export interface PlacementInput {
  /** Only the cards that may be shown. */
  readonly cards: readonly CardMeta[];
  readonly topics: readonly string[];
  readonly exclude: ReadonlySet<string>;
  readonly seen: ReadonlySet<string>;
  readonly seed: string;
}

/** Levels at distance 0, 1, 2 … from `target`, the lower side first. */
function nearestLevels(target: number): number[] {
  const levels = [target];
  for (let distance = 1; distance < MAX_LEVEL; distance += 1) {
    levels.push(target - distance, target + distance);
  }
  return levels.filter((level) => level >= 1 && level <= MAX_LEVEL);
}

/**
 * The placement deck: one card aimed at each level from 1 to 10, a missing
 * level made up from the nearest one, an unseen card preferred at each level,
 * sorted easiest first and shortest first within a level.
 */
export function choosePlacement(
  input: PlacementInput,
): Result<readonly string[], NotEnoughCards> {
  const random = seededRandom(input.seed);
  const pool = input.cards.filter(
    (card) => input.topics.includes(card.topic) && !input.exclude.has(card.id),
  );
  const chosen: CardMeta[] = [];
  for (let target = 1; target <= TUNING.placementSize; target += 1) {
    for (const level of nearestLevels(target)) {
      const open = pool.filter(
        (card) => card.level === level && !chosen.includes(card),
      );
      const unseen = open.filter((card) => !input.seen.has(card.id));
      const from = unseen.length > 0 ? unseen : open;
      const card = from[randomIndex(random, from.length)];
      if (card !== undefined) {
        chosen.push(card);
        break;
      }
    }
  }
  if (chosen.length < TUNING.minDeckSize) {
    return err({ available: pool.length });
  }
  return ok(
    chosen
      .sort(
        (a, b) => a.level - b.level || a.words - b.words || a.id.localeCompare(b.id),
      )
      .map((card) => card.id),
  );
}

export interface PlacementAnswer {
  readonly level: number;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
  readonly limitMs: number;
}

/**
 * The level a placement round sets: with k solid answers (correct, within the
 * solid share of the limit), the level of the k-th easiest card, or 1 for none.
 */
export function placementLevel(answers: readonly PlacementAnswer[]): number {
  const solid = answers.filter(
    (answer) =>
      answer.result === "ok" &&
      answer.elapsedMs <= answer.limitMs * TUNING.difficulty.placementSolidRatio,
  ).length;
  const levels = answers.map((answer) => answer.level).sort((a, b) => a - b);
  return solid === 0 ? 1 : (levels[solid - 1] ?? 1);
}
