// The read-only commands for vocabulary cards, run as `pnpm cards:<command>
// --kind vocab`: lint, show, queue, stats, dupes, gaps, new-id. Each reads the
// same content root as the drill's commands, and only its vocab/ half.
import { readKey } from "../lib/json.mjs";
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
  partitionIds,
  readInput,
  reportUnknown,
  STATUS_ORDER,
  vocabSource,
} from "./common.mjs";
import { CardsError } from "./errors.mjs";
import { DEFAULT_QUEUE_LIMIT, freshIds } from "./inspect.mjs";
import { MAX_PER_CELL, planVocabGaps } from "./plan.mjs";
import { fieldHash, readStamp } from "./schema.mjs";
import { compareIds, loadStore } from "./store.mjs";
import { findHeadwordDuplicates, lintVocabStore, vocabLabel } from "./vocab-rules.mjs";
import {
  asTypedVocab,
  isVocabShown,
  meaningStamp,
  randomVocabId,
  VOCAB_CATEGORIES,
  VOCAB_LANGUAGES,
  vocabStatusOf,
} from "./vocab-schema.mjs";

/**
 * @typedef {import("./common.mjs").Context} Context
 * @typedef {import("./args.mjs").Parsed} Parsed
 * @typedef {import("./args.mjs").CommandSpec} CommandSpec
 * @typedef {import("./store.mjs").CardEntry} CardEntry
 * @typedef {import("./store.mjs").Store} Store
 * @typedef {import("./rules.mjs").Finding} Finding
 */

/**
 * @param {Context} context - Output sink.
 * @param {unknown} value - Anything JSON-serializable.
 * @returns {void}
 */
function printJson(context, value) {
  context.out(JSON.stringify(value, null, 2));
}

/**
 * @param {CardEntry} entry - A stored vocabulary card.
 * @returns {string} `category L<n>`.
 */
function cellLabel(entry) {
  return `${String(entry.raw["category"])} L${String(entry.raw["level"])}`;
}

/**
 * @param {Store} store - The loaded content root.
 * @returns {Map<string, Finding[]>} Lint findings by card label.
 */
export function vocabFindingsByCard(store) {
  /** @type {Map<string, Finding[]>} */
  const byCard = new Map();
  for (const finding of lintVocabStore(store, undefined)) {
    byCard.set(finding.id, [...(byCard.get(finding.id) ?? []), finding]);
  }
  return byCard;
}

/**
 * @param {Record<string, unknown>} raw - A stored vocabulary card.
 * @returns {boolean} True when it is shown for some first language.
 */
export function shownSomewhere(raw) {
  const card = asTypedVocab(raw);
  return card !== undefined && VOCAB_LANGUAGES.some((lang) => isVocabShown(card, lang));
}

/**
 * The stored vocabulary cards among `ids`, reporting the rest on stderr.
 *
 * @param {Context} context - Output sink.
 * @param {Store} store - The loaded content root.
 * @param {readonly string[]} ids - Requested ids.
 * @returns {CardEntry[]} The cards found, in request order.
 */
function knownEntries(context, store, ids) {
  const { entries, unknown } = partitionIds(vocabSource(store), ids);
  reportUnknown(context, unknown);
  return entries;
}

/** @type {CommandSpec} */
export const vocabLintSpec = {
  usage: "--kind vocab [--ids <id,…>] [--json]",
  flags: { ids: "ids", json: "boolean" },
  range: false,
  vocab: true,
  positionals: 0,
};

/**
 * `cards:lint --kind vocab`: validate the lists and every vocabulary card.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 * @throws {CardsError} `ERR_CARDS_LINT` when any ERROR is found.
 */
export function runVocabLint(parsed, context) {
  const store = loadStore(context.root);
  const requested = idsFlag(parsed, "ids");
  const known =
    requested === undefined ? undefined : partitionIds(vocabSource(store), requested);
  if (known !== undefined) reportUnknown(context, known.unknown);
  const ids = known?.entries.map((entry) => String(entry.raw["id"]));
  const findings = lintVocabStore(store, ids === undefined ? undefined : new Set(ids));
  const checked = ids?.length ?? store.vocab.length;
  if (flag(parsed, "json")) {
    printJson(context, { checked, errors: findings });
  } else {
    for (const finding of findings) {
      context.out(`${finding.id} ${finding.rule} ${finding.message}`);
    }
    context.out(
      `cards:lint: ${String(checked)} vocab cards checked, ${String(findings.length)} errors`,
    );
  }
  if (findings.length > 0) {
    const labels = new Set(findings.map((finding) => finding.id));
    throw new CardsError("ERR_CARDS_LINT", "Lint found errors.", {
      expected: "no ERROR findings",
      actual: `${String(findings.length)} errors in ${String(labels.size)} vocab cards or files`,
      next: "fix the cards with `pnpm cards:update --kind vocab` or tombstone them; never hand-edit card JSON.",
    });
  }
  return 0;
}

/** @type {CommandSpec} */
export const vocabShowSpec = {
  usage:
    "--kind vocab [category=…] [level=…] [--ids <id,…>] [--level <n>|<n>-<m>] [--tombstones] [--brief] [--json]",
  flags: {
    ids: "ids",
    level: "string",
    tombstones: "boolean",
    brief: "boolean",
    json: "boolean",
  },
  range: true,
  vocab: true,
  positionals: 0,
};

/**
 * `cards:show --kind vocab`: print vocabulary cards or their tombstones.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runVocabShow(parsed, context) {
  const level = stringFlag(parsed, "level");
  if (level !== undefined) {
    const levels = parseLevelRange(level);
    if (levels === undefined) {
      throw usageError(
        "show",
        vocabShowSpec,
        `--level needs <n> or <n>-<m> within 1–10, got "${level}"`,
      );
    }
    parsed.range.levels = levels;
  }
  const store = loadStore(context.root);
  checkRange("show", vocabShowSpec, parsed.range, store.lists.topics);
  const ids = idsFlag(parsed, "ids");
  const brief = flag(parsed, "brief");
  const json = flag(parsed, "json");

  if (flag(parsed, "tombstones")) {
    const tombstones = store.vocabTombstones.filter(
      (tombstone) =>
        inRange(parsed.range, tombstone) &&
        (ids === undefined || ids.includes(tombstone.id)),
    );
    if (json) {
      printJson(context, tombstones);
    } else if (brief) {
      if (tombstones.length === 0) context.out("none");
      for (const tombstone of tombstones) {
        context.out(`${tombstone.headword} (${tombstone.category})`);
      }
    } else {
      for (const tombstone of tombstones) {
        const replaced =
          tombstone.replacedBy === undefined ? "" : ` → ${tombstone.replacedBy}`;
        context.out(
          `${tombstone.id}  ${tombstone.category} L${String(tombstone.level)}  deleted ${tombstone.deletedAt}${replaced}: ${tombstone.reason}`,
        );
        context.out(`  headword: ${tombstone.headword}`);
      }
      context.out(`${String(tombstones.length)} tombstones`);
    }
    return 0;
  }

  const pool = ids === undefined ? store.vocab : knownEntries(context, store, ids);
  const selected = pool.filter((entry) => inRange(parsed.range, entry.raw));
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
      context.out(
        `${String(entry.raw["headword"])} (${String(entry.raw["category"])})`,
      );
    }
    return 0;
  }
  const findings = vocabFindingsByCard(store);
  for (const entry of selected) {
    const label = vocabLabel(entry);
    const status = vocabStatusOf(
      entry.raw,
      findings.has(label),
      store.lists.vocabPerspectivesVersion,
    );
    const { headword, definition, example, example2, meanings } = entry.raw;
    context.out(`${label}  ${cellLabel(entry)}  ${status}`);
    context.out(`  headword: ${String(headword)}`);
    context.out(`  definition: ${String(definition)}`);
    context.out(`  example: ${String(example).replaceAll("\n", " / ")}`);
    context.out(`  example2: ${String(example2).replaceAll("\n", " / ")}`);
    context.out(`  meanings: ${JSON.stringify(meanings)}`);
  }
  context.out(`${String(selected.length)} vocab cards`);
  return 0;
}

/**
 * @param {string | undefined} field - A `--field` or `--missing` value.
 * @param {string} next - What to do instead, for the error.
 * @returns {string | undefined} The language a `meanings.<lang>` names;
 *   undefined for no value.
 * @throws {CardsError} `ERR_CARDS_UNKNOWN_FIELD` for anything else.
 */
export function meaningLanguage(field, next) {
  if (field === undefined) return undefined;
  /** @type {readonly string[]} */
  const languages = VOCAB_LANGUAGES;
  const lang = field.startsWith("meanings.") ? field.slice("meanings.".length) : "";
  if (!languages.includes(lang)) {
    throw new CardsError(
      "ERR_CARDS_UNKNOWN_FIELD",
      `"${field}" is not a stampable vocab field.`,
      {
        expected: `one of: ${languages.map(meaningStamp).join(", ")}`,
        actual: field,
        next,
      },
    );
  }
  return lang;
}

/** @type {CommandSpec} */
export const vocabQueueSpec = {
  usage:
    "--kind vocab [category=…] [level=…] [--ids <id,…>] [--field meanings.<lang> | --missing meanings.<lang>] [--limit <n>] [--count] [--json]",
  flags: {
    ids: "ids",
    field: "string",
    missing: "string",
    limit: "int",
    count: "boolean",
    json: "boolean",
  },
  range: true,
  vocab: true,
  positionals: 0,
};

/**
 * `cards:queue --kind vocab`: list vocabulary cards waiting for review, most
 * urgent first. A card waits while its core or any meaning it holds is not
 * current; `--field` instead lists the cards whose meaning in that language is
 * unstamped or changed, and `--missing` the cards that lack it.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runVocabQueue(parsed, context) {
  const store = loadStore(context.root);
  checkRange("queue", vocabQueueSpec, parsed.range, store.lists.topics);
  const fieldFlag = stringFlag(parsed, "field");
  const missingFlag = stringFlag(parsed, "missing");
  if (fieldFlag !== undefined && missingFlag !== undefined) {
    throw usageError("queue", vocabQueueSpec, "--field and --missing are exclusive");
  }
  const next = "rerun with a declared meanings.<lang>, or without the flag.";
  const fieldLang = meaningLanguage(fieldFlag, next);
  const missingLang = meaningLanguage(missingFlag, next);
  const ids = idsFlag(parsed, "ids");
  const pool = ids === undefined ? store.vocab : knownEntries(context, store, ids);
  const findings = vocabFindingsByCard(store);

  /** @type {{ entry: CardEntry, reason: string, rank: number }[]} */
  const queued = [];
  for (const entry of pool) {
    if (!inRange(parsed.range, entry.raw)) continue;
    const status = vocabStatusOf(
      entry.raw,
      findings.has(vocabLabel(entry)),
      store.lists.vocabPerspectivesVersion,
    );
    const meanings = readKey(entry.raw, "meanings");
    if (fieldLang !== undefined) {
      const meaning = readKey(meanings, fieldLang);
      if (meaning === undefined) continue;
      const stamp = readStamp(entry.raw["stamps"], meaningStamp(fieldLang));
      if (stamp === undefined)
        queued.push({ entry, reason: "field-unstamped", rank: 0 });
      else if (stamp.hash !== fieldHash(meaning)) {
        queued.push({ entry, reason: "field-changed", rank: 1 });
      }
    } else if (missingLang !== undefined) {
      if (readKey(meanings, missingLang) !== undefined) continue;
      const shown = shownSomewhere(entry.raw);
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
      compareIds(vocabLabel(left.entry), vocabLabel(right.entry)),
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
        errors: findings.get(vocabLabel(entry)) ?? [],
        card: entry.raw,
      })),
    );
    return 0;
  }
  for (const { entry, reason } of limited) {
    context.out(
      `${vocabLabel(entry)}  ${reason}  ${cellLabel(entry)}  ${String(entry.raw["headword"])}`,
    );
  }
  context.out(`${String(queued.length)} queued, ${String(limited.length)} listed`);
  return 0;
}

/** @type {CommandSpec} */
export const vocabStatsSpec = {
  usage: "--kind vocab [--short] [--json]",
  flags: { short: "boolean", json: "boolean" },
  range: false,
  vocab: true,
  positionals: 0,
};

/**
 * `cards:stats --kind vocab`: totals, review status, and coverage by
 * category × level.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runVocabStats(parsed, context) {
  const store = loadStore(context.root);
  const { lists } = store;
  const findings = vocabFindingsByCard(store);
  /** @type {Record<string, number>} */
  const byStatus = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  /** @type {Record<string, Record<string, number>>} */
  const byCategoryLevel = Object.fromEntries(
    VOCAB_CATEGORIES.map((category) => [category, {}]),
  );
  let shown = 0;
  for (const entry of store.vocab) {
    const status = vocabStatusOf(
      entry.raw,
      findings.has(vocabLabel(entry)),
      lists.vocabPerspectivesVersion,
    );
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (shownSomewhere(entry.raw)) shown += 1;
    const category = String(entry.raw["category"]);
    const level = String(entry.raw["level"]);
    const row = byCategoryLevel[category] ?? {};
    row[level] = (row[level] ?? 0) + 1;
    byCategoryLevel[category] = row;
  }
  const levelKeys = [...lists.levels.keys()];
  const emptyCells = VOCAB_CATEGORIES.flatMap((category) =>
    levelKeys
      .filter((level) => byCategoryLevel[category]?.[String(level)] === undefined)
      .map((level) => `${category}/${String(level)}`),
  );
  const cellTotal = VOCAB_CATEGORIES.length * levelKeys.length;

  if (flag(parsed, "json")) {
    printJson(context, {
      total: store.vocab.length,
      shown,
      byStatus,
      tombstones: store.vocabTombstones.length,
      byCategoryLevel,
      cells: { total: cellTotal, empty: emptyCells.length },
      emptyCells,
    });
    return 0;
  }
  const statusLine = STATUS_ORDER.map(
    (status) => `${status} ${String(byStatus[status] ?? 0)}`,
  ).join(", ");
  context.out(
    `vocab cards: ${String(store.vocab.length)} (shown ${String(shown)}; ${statusLine})`,
  );
  context.out(`tombstones: ${String(store.vocabTombstones.length)}`);
  context.out(`cells: ${String(cellTotal)}, empty ${String(emptyCells.length)}`);
  if (flag(parsed, "short")) return 0;
  context.out("");
  context.out(
    `by category × level: ${levelKeys.map((level) => `L${String(level)}`).join(" ")}  total`,
  );
  for (const [category, row] of Object.entries(byCategoryLevel)) {
    const counts = levelKeys.map((level) => row[String(level)] ?? 0);
    const total = Object.values(row).reduce((sum, count) => sum + count, 0);
    context.out(`  ${category}: ${counts.join(" ")}  ${String(total)}`);
  }
  return 0;
}

/** @type {CommandSpec} */
export const vocabDupesSpec = {
  usage: "--kind vocab [--ids <id,…>] [--input <file>] [--json]",
  flags: { ids: "ids", input: "string", json: "boolean" },
  range: false,
  vocab: true,
  positionals: 0,
};

/**
 * @param {Store} store - The loaded content root.
 * @returns {import("./vocab-rules.mjs").Headworded[]} Every typed card.
 */
function headworded(store) {
  return store.vocab.flatMap((entry) => {
    const card = asTypedVocab(entry.raw);
    return card === undefined
      ? []
      : [{ key: card.id, category: card.category, headword: card.headword }];
  });
}

/**
 * @param {unknown} value - One element of a `--input` file.
 * @param {number} index - Its position.
 * @returns {import("./vocab-rules.mjs").Headworded} The comparable card.
 * @throws {CardsError} `ERR_CARDS_INPUT` when a field is missing.
 */
function inputHeadworded(value, index) {
  const category = readKey(value, "category");
  const headword = readKey(value, "headword");
  if (typeof category !== "string" || typeof headword !== "string") {
    throw new CardsError("ERR_CARDS_INPUT", "A --input card is missing a field.", {
      expected: "every element to carry a string category and headword",
      actual: `element ${String(index)}`,
      next: "fix the input file and rerun.",
    });
  }
  return { key: `input[${String(index)}]`, category, headword };
}

/**
 * `cards:dupes --kind vocab`: cards sharing a normalized headword within a
 * category, with each other or with a tombstone.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runVocabDupes(parsed, context) {
  const store = loadStore(context.root);
  const cards = headworded(store);
  const ids = idsFlag(parsed, "ids");
  const input = stringFlag(parsed, "input");
  let subjects = cards;
  if (input !== undefined) {
    const parsedInput = readInput(input, "dupes");
    if (!Array.isArray(parsedInput)) {
      throw new CardsError("ERR_CARDS_INPUT", "The --input file is not a JSON array.", {
        expected: "a JSON array of vocabulary cards",
        actual: typeof parsedInput,
        next: "fix the input file and rerun.",
      });
    }
    subjects = parsedInput.map((value, index) => inputHeadworded(value, index));
  } else if (ids !== undefined) {
    const wanted = new Set(
      knownEntries(context, store, ids).map((entry) => String(entry.raw["id"])),
    );
    subjects = cards.filter((card) => wanted.has(card.key));
  }
  const tombstones = store.vocabTombstones.map((tombstone) => ({
    ...tombstone,
    key: tombstone.id,
  }));
  const pairs = findHeadwordDuplicates(subjects, cards, tombstones);
  const byKey = new Map(
    [...cards, ...tombstones, ...subjects].map((item) => [item.key, item]),
  );
  if (flag(parsed, "json")) {
    printJson(
      context,
      pairs.map((pair) => ({
        a: pair.a,
        b: pair.b,
        against: pair.against,
        category: byKey.get(pair.a)?.category ?? "",
        headword: byKey.get(pair.a)?.headword ?? "",
      })),
    );
    return 0;
  }
  for (const pair of pairs) {
    const subject = byKey.get(pair.a);
    context.out(
      `${pair.a} ~ ${pair.b} (${pair.against})  ${subject?.category ?? ""}: ${subject?.headword ?? ""}`,
    );
  }
  context.out(`${String(pairs.length)} duplicate headwords`);
  return 0;
}

/** @type {CommandSpec} */
export const vocabGapsSpec = {
  usage: "--kind vocab <count> [category=…] [level=…] [--json]",
  flags: { json: "boolean" },
  range: true,
  vocab: true,
  positionals: 1,
};

/**
 * `cards:gaps --kind vocab`: plan which category × level cells a generation
 * run fills.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runVocabGaps(parsed, context) {
  const countText = parsed.positionals[0];
  if (countText === undefined || !/^\d+$/u.test(countText) || Number(countText) < 1) {
    throw usageError(
      "gaps",
      vocabGapsSpec,
      `<count> must be a positive integer, got "${countText ?? ""}"`,
    );
  }
  const store = loadStore(context.root);
  checkRange("gaps", vocabGapsSpec, parsed.range, store.lists.topics);
  const requested = Number(countText);
  const plan = planVocabGaps({
    categories: VOCAB_CATEGORIES,
    cards: store.vocab,
    count: requested,
    range: parsed.range,
  });
  const planned = plan.reduce((sum, cell) => sum + cell.count, 0);
  const shortfall = requested - planned;
  if (shortfall > 0) {
    context.err(
      `WARN cards:gaps planned ${String(planned)} of ${String(requested)} vocab cards: ${String(plan.length)} cells in range × at most ${String(MAX_PER_CELL)} each.`,
    );
  }
  if (flag(parsed, "json")) {
    printJson(context, { plan, requested, planned, shortfall });
    return 0;
  }
  for (const cell of plan) {
    context.out(`${cell.category} L${String(cell.level)} ×${String(cell.count)}`);
  }
  context.out(`${String(planned)} vocab cards planned in ${String(plan.length)} cells`);
  return 0;
}

/** @type {CommandSpec} */
export const vocabNewIdSpec = {
  usage: "--kind vocab [n]",
  flags: {},
  range: false,
  vocab: true,
  positionals: 1,
};

/** The most ids one call hands out. */
const MAX_NEW_IDS = 1000;

/**
 * @param {Store} store - The loaded content root.
 * @returns {Set<string>} Every id a card or tombstone of either kind holds.
 */
export function takenVocabIds(store) {
  return new Set([
    ...[...store.cards, ...store.vocab].map((entry) => String(entry.raw["id"])),
    ...[...store.tombstones, ...store.vocabTombstones].map((tombstone) => tombstone.id),
  ]);
}

/**
 * `cards:new-id --kind vocab`: print fresh vocabulary ids.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runVocabNewId(parsed, context) {
  const countText = parsed.positionals[0] ?? "1";
  if (
    !/^\d+$/u.test(countText) ||
    Number(countText) < 1 ||
    Number(countText) > MAX_NEW_IDS
  ) {
    throw usageError(
      "new-id",
      vocabNewIdSpec,
      `[n] must be 1–${String(MAX_NEW_IDS)}, got "${countText}"`,
    );
  }
  const store = loadStore(context.root);
  for (const id of freshIds(
    takenVocabIds(store),
    Number(countText),
    context.random,
    randomVocabId,
  )) {
    context.out(id);
  }
  return 0;
}
