// The read-only commands: lint, show, queue, stats, dupes, gaps, new-id.
import {
  checkRange,
  flag,
  idsFlag,
  inRange,
  intFlag,
  parseLevelRange,
  stringFlag,
  usageError,
} from "./args.mjs";
import {
  asTyped,
  partitionIds,
  findingsByCard,
  readInput,
  reportUnknown,
  STATUS_ORDER,
  statusOf,
} from "./common.mjs";
import { CardsError } from "./errors.mjs";
import { MAX_PER_CELL, parseHistory, planGaps } from "./plan.mjs";
import { entryLabel, lintStore } from "./rules.mjs";
import { fieldHash, isShown, randomId, readStamp } from "./schema.mjs";
import { findNearDuplicates } from "./similarity.mjs";
import { compareIds, loadStore } from "./store.mjs";

/**
 * @typedef {import("./common.mjs").Context} Context
 * @typedef {import("./args.mjs").Parsed} Parsed
 * @typedef {import("./args.mjs").CommandSpec} CommandSpec
 * @typedef {import("./store.mjs").CardEntry} CardEntry
 * @typedef {import("./store.mjs").Store} Store
 */

/** The default number of cards `cards:queue` lists. */
export const DEFAULT_QUEUE_LIMIT = 50;

/**
 * @param {Context} context - Output sink.
 * @param {unknown} value - Anything JSON-serializable.
 * @returns {void}
 */
function printJson(context, value) {
  context.out(JSON.stringify(value, null, 2));
}

/**
 * @param {CardEntry} entry - A stored card.
 * @returns {string} `topic/subtopic L<n>`.
 */
function cellLabel(entry) {
  const { topic, subtopic, level } = entry.raw;
  return `${String(topic)}/${String(subtopic)} L${String(level)}`;
}

/**
 * Resolve an optional-field name given on the command line.
 *
 * @param {Context} context - Declared fields.
 * @param {string} name - The name given.
 * @returns {string} The name, once known to be declared.
 * @throws {CardsError} `ERR_CARDS_UNKNOWN_FIELD`.
 */
export function declaredField(context, name) {
  if (!context.optionalFields.some((field) => field.name === name)) {
    throw new CardsError(
      "ERR_CARDS_UNKNOWN_FIELD",
      `"${name}" is not a declared card field.`,
      {
        expected: `one of: ${context.optionalFields.map((field) => field.name).join(", ") || "(none declared yet)"}`,
        actual: name,
        next: "declare the field in OPTIONAL_FIELDS in scripts/cards/schema.mjs first (see backfilling-card-fields).",
      },
    );
  }
  return name;
}

/**
 * The stored cards among `ids`, reporting the rest on stderr.
 *
 * @param {Context} context - Output sink.
 * @param {Store} store - The loaded content root.
 * @param {readonly string[]} ids - Requested ids.
 * @returns {CardEntry[]} The cards found, in request order.
 */
function knownEntries(context, store, ids) {
  const { entries, unknown } = partitionIds(store, ids);
  reportUnknown(context, unknown);
  return entries;
}

/** @type {CommandSpec} */
export const lintSpec = {
  usage: "[--ids <id,…>] [--json]",
  flags: { ids: "ids", json: "boolean" },
  range: false,
  positionals: 0,
};

/**
 * `cards:lint`: validate the lists and every card (or `--ids`).
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 * @throws {CardsError} `ERR_CARDS_LINT` when any ERROR is found.
 */
export function runLint(parsed, context) {
  const store = loadStore(context.root);
  const requested = idsFlag(parsed, "ids");
  const known = requested === undefined ? undefined : partitionIds(store, requested);
  if (known !== undefined) reportUnknown(context, known.unknown);
  const ids = known?.entries.map((entry) => String(entry.raw["id"]));
  const findings = lintStore(
    store,
    { lists: store.lists, optionalFields: context.optionalFields },
    ids === undefined ? undefined : new Set(ids),
  );
  const checked = ids?.length ?? store.cards.length;
  if (flag(parsed, "json")) {
    printJson(context, { checked, errors: findings });
  } else {
    for (const finding of findings) {
      context.out(`${finding.id} ${finding.rule} ${finding.message}`);
    }
    context.out(
      `cards:lint: ${String(checked)} cards checked, ${String(findings.length)} errors`,
    );
  }
  if (findings.length > 0) {
    const labels = new Set(findings.map((finding) => finding.id));
    throw new CardsError("ERR_CARDS_LINT", "Lint found errors.", {
      expected: "no ERROR findings",
      actual: `${String(findings.length)} errors in ${String(labels.size)} cards or files`,
      next: "fix the cards through `reviewing-cards` (it takes lint-error cards first); never hand-edit card JSON.",
    });
  }
  return 0;
}

/** @type {CommandSpec} */
export const showSpec = {
  usage:
    "[topic=…] [subtopic=…] [level=…] [--ids <id,…>] [--cell <topic>/<subtopic>] [--level <n>|<n>-<m>] [--tombstones] [--brief] [--json]",
  flags: {
    ids: "ids",
    cell: "string",
    level: "string",
    tombstones: "boolean",
    brief: "boolean",
    json: "boolean",
  },
  range: true,
  positionals: 0,
};

/**
 * Fold `--cell` and `--level` into the range filters.
 *
 * @param {Parsed} parsed - Arguments.
 * @returns {void}
 */
function foldShowFilters(parsed) {
  const cell = stringFlag(parsed, "cell");
  if (cell !== undefined) {
    const [topic = "", subtopic = "", extra] = cell.split("/");
    if (topic === "" || subtopic === "" || extra !== undefined) {
      throw usageError(
        "show",
        showSpec,
        `--cell needs <topic>/<subtopic>, got "${cell}"`,
      );
    }
    parsed.range.subtopic = { topic, subtopic };
  }
  const level = stringFlag(parsed, "level");
  if (level !== undefined) {
    const levels = parseLevelRange(level);
    if (levels === undefined) {
      throw usageError(
        "show",
        showSpec,
        `--level needs <n> or <n>-<m> within 1–10, got "${level}"`,
      );
    }
    parsed.range.levels = levels;
  }
}

/**
 * `cards:show`: print cards or tombstones.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runShow(parsed, context) {
  foldShowFilters(parsed);
  const store = loadStore(context.root);
  checkRange("show", showSpec, parsed.range, store.lists.topics);
  const ids = idsFlag(parsed, "ids");
  const brief = flag(parsed, "brief");
  const json = flag(parsed, "json");

  if (flag(parsed, "tombstones")) {
    const tombstones = store.tombstones.filter(
      (tombstone) =>
        inRange(parsed.range, tombstone) &&
        (ids === undefined || ids.includes(tombstone.id)),
    );
    if (json) {
      printJson(context, tombstones);
    } else if (brief) {
      if (tombstones.length === 0) context.out("none");
      for (const tombstone of tombstones)
        context.out(`${tombstone.ja} ⟶ ${tombstone.en}`);
    } else {
      for (const tombstone of tombstones) {
        const replaced =
          tombstone.replacedBy === undefined ? "" : ` → ${tombstone.replacedBy}`;
        context.out(
          `${tombstone.id}  ${tombstone.topic}/${tombstone.subtopic} L${String(tombstone.level)}  deleted ${tombstone.deletedAt}${replaced}: ${tombstone.reason}`,
        );
        context.out(`  ja: ${tombstone.ja}`);
        context.out(`  en: ${tombstone.en}`);
      }
      context.out(`${String(tombstones.length)} tombstones`);
    }
    return 0;
  }

  const selected =
    ids === undefined
      ? store.cards.filter((entry) => inRange(parsed.range, entry.raw))
      : knownEntries(context, store, ids).filter((entry) =>
          inRange(parsed.range, entry.raw),
        );
  if (json) {
    printJson(
      context,
      selected.map((entry) => entry.raw),
    );
    return 0;
  }
  if (brief) {
    if (selected.length === 0) context.out("none");
    for (const entry of selected) {
      context.out(`${String(entry.raw["ja"])} ⟶ ${String(entry.raw["en"])}`);
    }
    return 0;
  }
  const findings = findingsByCard(store, context);
  for (const entry of selected) {
    const label = entryLabel(entry);
    const status = statusOf(
      entry.raw,
      findings.has(label),
      store.lists.perspectivesVersion,
    );
    const { ja, en, alternatives, point, grammar } = entry.raw;
    context.out(`${label}  ${cellLabel(entry)}  ${status}`);
    context.out(`  ja: ${String(ja)}`);
    context.out(`  en: ${String(en)}`);
    context.out(
      `  alternatives: ${Array.isArray(alternatives) ? alternatives.map(String).join(" | ") : String(alternatives)}`,
    );
    context.out(`  point: ${String(point)}`);
    context.out(
      `  grammar: ${Array.isArray(grammar) ? grammar.map(String).join(", ") : String(grammar)}`,
    );
    for (const field of context.optionalFields) {
      if (field.name in entry.raw) {
        context.out(`  ${field.name}: ${JSON.stringify(entry.raw[field.name])}`);
      }
    }
  }
  context.out(`${String(selected.length)} cards`);
  return 0;
}

/** @type {CommandSpec} */
export const queueSpec = {
  usage:
    "[topic=…] [subtopic=…] [level=…] [--ids <id,…>] [--limit <n>] [--count] [--field <name> | --missing <name>] [--json]",
  flags: {
    ids: "ids",
    limit: "int",
    count: "boolean",
    field: "string",
    missing: "string",
    json: "boolean",
  },
  range: true,
  positionals: 0,
};

/**
 * @typedef {object} Queued
 * @property {CardEntry} entry
 * @property {string} reason - Why it is queued.
 * @property {number} rank - Sort rank of the reason.
 */

/**
 * `cards:queue`: list cards waiting for review, most urgent first.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runQueue(parsed, context) {
  const store = loadStore(context.root);
  checkRange("queue", queueSpec, parsed.range, store.lists.topics);
  const fieldFlag = stringFlag(parsed, "field");
  const missingFlag = stringFlag(parsed, "missing");
  if (fieldFlag !== undefined && missingFlag !== undefined) {
    throw usageError("queue", queueSpec, "--field and --missing are exclusive");
  }
  const fieldName =
    fieldFlag === undefined ? undefined : declaredField(context, fieldFlag);
  const missingName =
    missingFlag === undefined ? undefined : declaredField(context, missingFlag);
  const ids = idsFlag(parsed, "ids");
  const pool = ids === undefined ? store.cards : knownEntries(context, store, ids);
  const findings = findingsByCard(store, context);

  /** @type {Queued[]} */
  const queued = [];
  for (const entry of pool) {
    if (!inRange(parsed.range, entry.raw)) continue;
    const label = entryLabel(entry);
    const status = statusOf(
      entry.raw,
      findings.has(label),
      store.lists.perspectivesVersion,
    );
    if (fieldName !== undefined) {
      if (!(fieldName in entry.raw)) continue;
      const stamp = readStamp(entry.raw["stamps"], fieldName);
      if (stamp === undefined)
        queued.push({ entry, reason: "field-unstamped", rank: 0 });
      else if (stamp.hash !== fieldHash(entry.raw[fieldName])) {
        queued.push({ entry, reason: "field-changed", rank: 1 });
      }
    } else if (missingName !== undefined) {
      if (missingName in entry.raw) continue;
      const typed = asTyped(entry.raw);
      const shown = typed !== undefined && isShown(typed);
      queued.push({
        entry,
        reason: shown ? "missing (shown)" : "missing",
        rank: shown ? 0 : 1,
      });
    } else if (status !== "current" || ids !== undefined) {
      queued.push({ entry, reason: status, rank: STATUS_ORDER.indexOf(status) });
    }
  }
  queued.sort(
    (left, right) =>
      left.rank - right.rank ||
      String(left.entry.raw["createdAt"]).localeCompare(
        String(right.entry.raw["createdAt"]),
      ) ||
      compareIds(entryLabel(left.entry), entryLabel(right.entry)),
  );

  if (flag(parsed, "count")) {
    context.out(String(queued.length));
    return 0;
  }
  const limited = queued.slice(0, intFlag(parsed, "limit") ?? DEFAULT_QUEUE_LIMIT);
  if (flag(parsed, "json")) {
    printJson(
      context,
      limited.map(({ entry, reason }) => ({
        reason,
        errors: findings.get(entryLabel(entry)) ?? [],
        card: entry.raw,
      })),
    );
    return 0;
  }
  for (const { entry, reason } of limited) {
    context.out(
      `${entryLabel(entry)}  ${reason}  ${cellLabel(entry)}  ${String(entry.raw["ja"])}`,
    );
  }
  context.out(`${String(queued.length)} queued, ${String(limited.length)} listed`);
  return 0;
}

/** @type {CommandSpec} */
export const statsSpec = {
  usage: "[--short] [--json]",
  flags: { short: "boolean", json: "boolean" },
  range: false,
  positionals: 0,
};

/**
 * @param {string} reason - A tombstone's reason.
 * @returns {string} Its prefix: the text before the first colon, or the whole.
 */
function reasonPrefix(reason) {
  const colon = reason.indexOf(":");
  return (colon === -1 ? reason : reason.slice(0, colon)).trim();
}

/**
 * `cards:stats`: totals, review status, coverage by cell, grammar usage.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runStats(parsed, context) {
  const store = loadStore(context.root);
  const { lists } = store;
  const findings = findingsByCard(store, context);

  /** @type {Record<string, number>} */
  const byStatus = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  /** @type {Record<string, Record<string, number>>} */
  const byTopicLevel = {};
  /** @type {Map<string, number>} */
  const cellCounts = new Map();
  /** @type {Record<string, number>} */
  const grammarUsage = Object.fromEntries(lists.grammar.map((item) => [item.id, 0]));
  let shown = 0;
  for (const entry of store.cards) {
    const status = statusOf(
      entry.raw,
      findings.has(entryLabel(entry)),
      lists.perspectivesVersion,
    );
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const typed = asTyped(entry.raw);
    if (typed === undefined) continue;
    if (isShown(typed)) shown += 1;
    const perTopic = byTopicLevel[typed.topic] ?? {};
    perTopic[String(typed.level)] = (perTopic[String(typed.level)] ?? 0) + 1;
    byTopicLevel[typed.topic] = perTopic;
    const cell = `${typed.topic}/${typed.subtopic}/${String(typed.level)}`;
    cellCounts.set(cell, (cellCounts.get(cell) ?? 0) + 1);
    for (const grammarId of typed.grammar) {
      grammarUsage[grammarId] = (grammarUsage[grammarId] ?? 0) + 1;
    }
  }
  /** @type {Record<string, number>} */
  const byReason = {};
  for (const tombstone of store.tombstones) {
    const prefix = reasonPrefix(tombstone.reason);
    byReason[prefix] = (byReason[prefix] ?? 0) + 1;
  }
  /** @type {string[]} */
  const emptyCells = [];
  let cellTotal = 0;
  for (const topic of lists.topics) {
    for (const subtopic of topic.subtopics) {
      for (const level of lists.levels.keys()) {
        cellTotal += 1;
        const cell = `${topic.id}/${subtopic.id}/${String(level)}`;
        if (!cellCounts.has(cell)) emptyCells.push(cell);
      }
    }
  }

  if (flag(parsed, "json")) {
    printJson(context, {
      total: store.cards.length,
      shown,
      byStatus,
      tombstones: { total: store.tombstones.length, byReason },
      byTopicLevel,
      grammarUsage,
      cells: { total: cellTotal, empty: emptyCells.length },
      emptyCells,
    });
    return 0;
  }

  const statusLine = STATUS_ORDER.map(
    (status) => `${status} ${String(byStatus[status] ?? 0)}`,
  ).join(", ");
  const reasons = Object.entries(byReason)
    .map(([reason, count]) => `${reason} ${String(count)}`)
    .join(", ");
  context.out(
    `cards: ${String(store.cards.length)} (shown ${String(shown)}; ${statusLine})`,
  );
  context.out(
    `tombstones: ${String(store.tombstones.length)}${reasons === "" ? "" : ` (${reasons})`}`,
  );
  context.out(`cells: ${String(cellTotal)}, empty ${String(emptyCells.length)}`);
  if (flag(parsed, "short")) return 0;

  const levelKeys = [...lists.levels.keys()];
  context.out("");
  context.out(
    `by topic × level: ${levelKeys.map((level) => `L${String(level)}`).join(" ")}`,
  );
  for (const topic of lists.topics) {
    const row = byTopicLevel[topic.id] ?? {};
    context.out(
      `  ${topic.id}: ${levelKeys.map((level) => String(row[String(level)] ?? 0)).join(" ")}`,
    );
  }
  context.out("");
  context.out("grammar usage:");
  for (const [grammarId, count] of Object.entries(grammarUsage).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )) {
    context.out(`  ${grammarId} ${String(count)}`);
  }
  context.out("");
  context.out("empty cells:");
  /** @type {Map<string, string[]>} */
  const emptyBySubtopic = new Map();
  for (const cell of emptyCells) {
    const cut = cell.lastIndexOf("/");
    const key = cell.slice(0, cut);
    emptyBySubtopic.set(key, [
      ...(emptyBySubtopic.get(key) ?? []),
      `L${cell.slice(cut + 1)}`,
    ]);
  }
  for (const [subtopic, levels] of emptyBySubtopic) {
    context.out(`  ${subtopic}: ${levels.join(" ")}`);
  }
  return 0;
}

/** @type {CommandSpec} */
export const dupesSpec = {
  usage: "[--ids <id,…>] [--input <file>] [--json]",
  flags: { ids: "ids", input: "string", json: "boolean" },
  range: false,
  positionals: 0,
};

/**
 * @param {unknown} value - One element of a `--input` file.
 * @param {number} index - Its position.
 * @returns {import("./similarity.mjs").Comparable} The comparable card.
 * @throws {CardsError} `ERR_CARDS_INPUT` when a field is missing.
 */
function inputComparable(value, index) {
  const typed =
    typeof value === "object" && value !== null
      ? asTyped({ id: `input[${String(index)}]`, ...value })
      : undefined;
  if (typed === undefined) {
    throw new CardsError("ERR_CARDS_INPUT", "A --input card is missing a field.", {
      expected:
        "every element to carry ja, en, alternatives, point, topic, subtopic, level, grammar",
      actual: `element ${String(index)}`,
      next: "fix the input file and rerun.",
    });
  }
  return { ...typed, key: typed.id };
}

/**
 * @param {Store} store - The loaded content root.
 * @returns {import("./similarity.mjs").Comparable[]} Every typed card.
 */
function comparableCards(store) {
  return store.cards.flatMap((entry) => {
    const typed = asTyped(entry.raw);
    return typed === undefined ? [] : [{ ...typed, key: typed.id }];
  });
}

/**
 * `cards:dupes`: near-duplicate candidates.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runDupes(parsed, context) {
  const store = loadStore(context.root);
  const cards = comparableCards(store);
  const ids = idsFlag(parsed, "ids");
  const input = stringFlag(parsed, "input");
  /** @type {import("./similarity.mjs").Comparable[]} */
  let subjects = cards;
  if (input !== undefined) {
    const parsedInput = readInput(input, "dupes");
    if (!Array.isArray(parsedInput)) {
      throw new CardsError("ERR_CARDS_INPUT", "The --input file is not a JSON array.", {
        expected: "a JSON array of cards",
        actual: typeof parsedInput,
        next: "fix the input file and rerun.",
      });
    }
    subjects = parsedInput.map((value, index) => inputComparable(value, index));
  } else if (ids !== undefined) {
    const wanted = new Set(
      knownEntries(context, store, ids).map((entry) => String(entry.raw["id"])),
    );
    subjects = cards.filter((card) => wanted.has(card.key));
  }
  const tombstones = store.tombstones.map((tombstone) => ({
    ...tombstone,
    key: tombstone.id,
  }));
  const pairs = findNearDuplicates(subjects, cards, tombstones);
  /** @type {Map<string, import("./similarity.mjs").Comparable>} */
  const byKey = new Map(
    [...cards, ...tombstones, ...subjects].map((item) => [item.key, item]),
  );
  const describe = (/** @type {string} */ key) => {
    const item = byKey.get(key);
    return { key, ja: item?.ja ?? "", en: item?.en ?? "" };
  };

  if (flag(parsed, "json")) {
    printJson(
      context,
      pairs.map((pair) => ({
        a: describe(pair.a),
        b: describe(pair.b),
        against: pair.against,
        scores: { ja: pair.ja, en: pair.en },
      })),
    );
    return 0;
  }
  for (const pair of pairs) {
    const a = describe(pair.a);
    const b = describe(pair.b);
    context.out(
      `ja ${pair.ja.toFixed(2)} / en ${pair.en.toFixed(2)}  ${pair.a} ~ ${pair.b} (${pair.against})`,
    );
    context.out(`  ${a.key}: ${a.ja} ⟶ ${a.en}`);
    context.out(`  ${b.key}: ${b.ja} ⟶ ${b.en}`);
  }
  context.out(`${String(pairs.length)} near-duplicate candidates`);
  return 0;
}

/** @type {CommandSpec} */
export const gapsSpec = {
  usage: "<count> [topic=…] [subtopic=…] [level=…] [--history <file>] [--json]",
  flags: { history: "string", json: "boolean" },
  range: true,
  positionals: 1,
};

/**
 * `cards:gaps`: plan which cells a generation run fills.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runGaps(parsed, context) {
  const countText = parsed.positionals[0];
  if (countText === undefined || !/^\d+$/u.test(countText) || Number(countText) < 1) {
    throw usageError(
      "gaps",
      gapsSpec,
      `<count> must be a positive integer, got "${countText ?? ""}"`,
    );
  }
  const store = loadStore(context.root);
  checkRange("gaps", gapsSpec, parsed.range, store.lists.topics);
  const historyFile = stringFlag(parsed, "history");
  const history =
    historyFile === undefined
      ? undefined
      : parseHistory(readInput(historyFile, "gaps"));
  const plan = planGaps({
    lists: store.lists,
    cards: store.cards,
    visible: (entry) => {
      const typed = asTyped(entry.raw);
      return (
        typed !== undefined &&
        (isShown(typed) || readStamp(typed.stamps, "core") === undefined)
      );
    },
    count: Number(countText),
    range: parsed.range,
    history,
  });
  const requested = Number(countText);
  const planned = plan.reduce((sum, cell) => sum + cell.count, 0);
  const shortfall = requested - planned;
  if (shortfall > 0) {
    context.err(
      `WARN cards:gaps planned ${String(planned)} of ${String(requested)} cards: ${String(plan.length)} cells in range × at most ${String(MAX_PER_CELL)} each.`,
    );
  }
  if (flag(parsed, "json")) {
    printJson(context, { plan, requested, planned, shortfall });
    return 0;
  }
  for (const cell of plan) {
    context.out(
      `${cell.topic}/${cell.subtopic} L${String(cell.level)} ×${String(cell.count)}  grammar: ${cell.targetGrammar.join(", ")}`,
    );
  }
  context.out(`${String(planned)} cards planned in ${String(plan.length)} cells`);
  return 0;
}

/** @type {CommandSpec} */
export const newIdSpec = {
  usage: "[n]",
  flags: {},
  range: false,
  positionals: 1,
};

/** The most ids one call hands out. */
const MAX_NEW_IDS = 1000;

/**
 * Draw ids unused by any card, tombstone, or id already drawn.
 *
 * @param {Set<string>} taken - Ids in use; drawn ids are added to it.
 * @param {number} count - How many to draw.
 * @param {(max: number) => number} random - Integer source.
 * @returns {string[]} The fresh ids.
 * @throws {CardsError} `ERR_CARDS_ID_SPACE` when the random source keeps
 *   returning taken ids.
 */
export function freshIds(taken, count, random) {
  /** @type {string[]} */
  const ids = [];
  for (let attempts = 0; ids.length < count; attempts += 1) {
    if (attempts > count * 100) {
      throw new CardsError("ERR_CARDS_ID_SPACE", "Could not draw an unused card id.", {
        expected: `${String(count)} unused ids`,
        actual: `${String(ids.length)} after ${String(attempts)} draws`,
        next: "rerun the command; if it repeats, report it — the random source is not random.",
      });
    }
    const id = randomId(random);
    if (taken.has(id)) continue;
    taken.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * @param {Store} store - The loaded content root.
 * @returns {Set<string>} Every id used by a card or a tombstone.
 */
export function takenIds(store) {
  return new Set([
    ...store.cards.map((entry) => String(entry.raw["id"])),
    ...store.tombstones.map((tombstone) => tombstone.id),
  ]);
}

/**
 * `cards:new-id`: print fresh ids.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runNewId(parsed, context) {
  const countText = parsed.positionals[0] ?? "1";
  if (
    !/^\d+$/u.test(countText) ||
    Number(countText) < 1 ||
    Number(countText) > MAX_NEW_IDS
  ) {
    throw usageError(
      "new-id",
      newIdSpec,
      `[n] must be 1–${String(MAX_NEW_IDS)}, got "${countText}"`,
    );
  }
  const store = loadStore(context.root);
  for (const id of freshIds(takenIds(store), Number(countText), context.random)) {
    context.out(id);
  }
  return 0;
}
