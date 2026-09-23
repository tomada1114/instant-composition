// `cards:gaps`: decide which cells a generation run fills, and with which
// grammar targets.
import { readKey } from "../lib/json.mjs";
import { inRange, isEmptyRange } from "./args.mjs";
import { spreadRank } from "./common.mjs";
import { CardsError } from "./errors.mjs";

/**
 * The most cards one run asks one writer for. Small on purpose: a run of 1000
 * cards then touches about 333 of the cells instead of 200.
 */
export const MAX_PER_CELL = 3;

/** How much a focus subtopic's deficit is multiplied by, under `--history`. */
export const FOCUS_WEIGHT = 2;

/**
 * The card count a cell is measured against: its deficit is how far short of
 * this it is. It only has to sit above any count a cell reaches in practice.
 */
export const CELL_TARGET = 20;

/**
 * What the app will know about a learner, fed in with `--history`.
 *
 * @typedef {object} History
 * @property {string[]} seenIds - Cards the learner has already answered.
 * @property {string[]} topics - Topics they chose; empty means all.
 * @property {string[]} focusSubtopics - `topic/subtopic` they want more of.
 * @property {number} estimatedLevel - Their current level, 1–10.
 */

/**
 * @typedef {object} PlannedCell
 * @property {string} topic
 * @property {string} subtopic
 * @property {number} level
 * @property {number} count - Cards to write.
 * @property {string[]} targetGrammar - 2–3 grammar ids to aim at.
 */

/**
 * @typedef {object} PlanInput
 * @property {import("./store.mjs").Lists} lists
 * @property {import("./store.mjs").CardEntry[]} cards
 * @property {(entry: import("./store.mjs").CardEntry) => boolean} visible -
 *   Whether a card counts as available under `--history` (shown or unstamped).
 * @property {number} count - Cards to plan.
 * @property {import("./args.mjs").Range} range
 * @property {History | undefined} history
 */

/**
 * @param {unknown} value - Candidate.
 * @returns {value is string[]} True for an array of strings.
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * @param {unknown} value - The parsed `--history` file.
 * @returns {History} The history.
 * @throws {CardsError} `ERR_CARDS_INPUT` when a field is missing or mistyped.
 */
export function parseHistory(value) {
  const seenIds = readKey(value, "seenIds");
  const topics = readKey(value, "topics");
  const focusSubtopics = readKey(value, "focusSubtopics");
  const estimatedLevel = readKey(value, "estimatedLevel");
  if (
    !isStringArray(seenIds) ||
    !isStringArray(topics) ||
    !isStringArray(focusSubtopics) ||
    typeof estimatedLevel !== "number" ||
    !Number.isInteger(estimatedLevel) ||
    estimatedLevel < 1 ||
    estimatedLevel > 10
  ) {
    throw new CardsError("ERR_CARDS_INPUT", "The --history file has the wrong shape.", {
      expected:
        "{ seenIds: string[], topics: string[], focusSubtopics: string[] (topic/subtopic), estimatedLevel: 1–10 }",
      actual: "a missing or mistyped field",
      next: "fix the history file, or run `pnpm cards:gaps <count>` without --history.",
    });
  }
  return { seenIds, topics, focusSubtopics, estimatedLevel };
}

/**
 * Plan a generation run.
 *
 * @remarks
 * Cells are subtopic × level. Each gets a deficit — how far its count (the
 * cards it has, or under `--history` the cards the learner has not seen) is
 * short of {@link CELL_TARGET}, times {@link FOCUS_WEIGHT} for a focus
 * subtopic — and the largest deficits are filled first, fewest cards breaking
 * a tie, up to {@link MAX_PER_CELL} each. An empty focus cell therefore comes
 * before an empty ordinary one. Ties fall to a fixed pseudo-random
 * order that interleaves topics round-robin, so an empty repository is not
 * filled topic 1 first.
 *
 * @param {PlanInput} input - Lists, cards, count, range and history.
 * @returns {PlannedCell[]} The cells to fill, in plan order.
 */
export function planGaps(input) {
  const { lists, range, history, count } = input;
  const useHistory = history !== undefined && isEmptyRange(range);
  const seen = new Set(useHistory ? history.seenIds : []);
  const focus = new Set(useHistory ? history.focusSubtopics : []);

  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Map<string, Map<string, number>>} */
  const grammarUse = new Map();
  for (const entry of input.cards) {
    const { topic, subtopic, level, grammar, id } = entry.raw;
    const subKey = `${String(topic)}/${String(subtopic)}`;
    const use =
      grammarUse.get(subKey) ?? /** @type {Map<string, number>} */ (new Map());
    for (const grammarId of isStringArray(grammar) ? grammar : []) {
      use.set(grammarId, (use.get(grammarId) ?? 0) + 1);
    }
    grammarUse.set(subKey, use);
    if (useHistory && (seen.has(String(id)) || !input.visible(entry))) continue;
    const cellKey = `${subKey}/${String(level)}`;
    counts.set(cellKey, (counts.get(cellKey) ?? 0) + 1);
  }

  const levels = useHistory
    ? {
        min: Math.max(1, history.estimatedLevel - 1),
        max: Math.min(10, history.estimatedLevel + 1),
      }
    : (range.levels ?? { min: 1, max: 10 });

  /** @type {{ topic: string, subtopic: string, level: number, have: number, deficit: number, order: [number, number] }[]} */
  const cells = [];
  for (const [topicIndex, topic] of lists.topics.entries()) {
    if (useHistory && history.topics.length > 0 && !history.topics.includes(topic.id))
      continue;
    /** @type {{ subtopic: string, level: number, rank: string }[]} */
    const inTopic = [];
    for (const subtopic of topic.subtopics) {
      for (let level = levels.min; level <= levels.max; level += 1) {
        if (!inRange(range, { topic: topic.id, subtopic: subtopic.id, level }))
          continue;
        inTopic.push({
          subtopic: subtopic.id,
          level,
          rank: spreadRank(`${topic.id}/${subtopic.id}/${String(level)}`),
        });
      }
    }
    inTopic.sort((left, right) => (left.rank < right.rank ? -1 : 1));
    for (const [position, cell] of inTopic.entries()) {
      const key = `${topic.id}/${cell.subtopic}`;
      const have = counts.get(`${key}/${String(cell.level)}`) ?? 0;
      cells.push({
        topic: topic.id,
        subtopic: cell.subtopic,
        level: cell.level,
        have,
        deficit: Math.max(0, CELL_TARGET - have) * (focus.has(key) ? FOCUS_WEIGHT : 1),
        order: [position, topicIndex],
      });
    }
  }
  cells.sort(
    (left, right) =>
      right.deficit - left.deficit ||
      left.have - right.have ||
      left.order[0] - right.order[0] ||
      left.order[1] - right.order[1],
  );

  /** @type {PlannedCell[]} */
  const plan = [];
  let remaining = count;
  for (const cell of cells) {
    if (remaining <= 0) break;
    const take = Math.min(MAX_PER_CELL, remaining);
    remaining -= take;
    const use =
      grammarUse.get(`${cell.topic}/${cell.subtopic}`) ??
      /** @type {Map<string, number>} */ (new Map());
    const targetGrammar = lists.grammar
      .filter((item) => item.minLevel <= cell.level && cell.level <= item.maxLevel)
      .map((item) => ({
        id: item.id,
        used: use.get(item.id) ?? 0,
        rank: spreadRank(
          `${cell.topic}/${cell.subtopic}/${String(cell.level)}:${item.id}`,
        ),
      }))
      .sort(
        (left, right) => left.used - right.used || (left.rank < right.rank ? -1 : 1),
      )
      .slice(0, take >= 3 ? 3 : 2)
      .map((item) => item.id);
    plan.push({
      topic: cell.topic,
      subtopic: cell.subtopic,
      level: cell.level,
      count: take,
      targetGrammar,
    });
  }
  return plan;
}
