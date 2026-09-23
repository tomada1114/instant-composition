// The commands that write: add, update, tombstone, stamp. Each loads the whole
// content root, changes it in memory, and writes back only the files it
// touched, through the store's canonical writer.
import { readKey } from "../lib/json.mjs";
import { flag, idsFlag, stringFlag, usageError } from "./args.mjs";
import {
  asTyped,
  entriesById,
  entryById,
  findingsByCard,
  readInput,
} from "./common.mjs";
import { CardsError } from "./errors.mjs";
import { declaredField, freshIds, takenIds } from "./inspect.mjs";
import { lintCard } from "./rules.mjs";
import { CORE_FIELDS, coreHash, fieldHash } from "./schema.mjs";
import { findNearDuplicates } from "./similarity.mjs";
import {
  appendTombstones,
  cardFile,
  loadStore,
  orderCard,
  writeCardFiles,
} from "./store.mjs";

/**
 * @typedef {import("./common.mjs").Context} Context
 * @typedef {import("./args.mjs").Parsed} Parsed
 * @typedef {import("./args.mjs").CommandSpec} CommandSpec
 * @typedef {import("./store.mjs").Store} Store
 * @typedef {import("./rules.mjs").Finding} Finding
 */

/**
 * @typedef {object} Reason
 * @property {string} rule
 * @property {string} message
 */

/**
 * @param {Context} context - Declared fields.
 * @returns {string[]} Declared optional field names.
 */
function optionalNames(context) {
  return context.optionalFields.map((field) => field.name);
}

/**
 * @param {Context} context - Output sink.
 * @param {unknown} value - Anything JSON-serializable.
 * @returns {void}
 */
function printJson(context, value) {
  context.out(JSON.stringify(value, null, 2));
}

/**
 * Read an input file that must hold a JSON array.
 *
 * @param {string | undefined} file - Path as given.
 * @param {string} command - Command name.
 * @param {CommandSpec} spec - Its spec.
 * @returns {unknown[]} The array.
 * @throws {CardsError} `ERR_CARDS_USAGE` without a file, `ERR_CARDS_INPUT`
 *   when it is not an array.
 */
function readArrayInput(file, command, spec) {
  if (file === undefined) throw usageError(command, spec, "no input file given");
  const value = readInput(file, command);
  if (!Array.isArray(value)) {
    throw new CardsError(
      "ERR_CARDS_INPUT",
      `The input for cards:${command} is not a JSON array.`,
      {
        expected: "a JSON array",
        actual: value === null ? "null" : typeof value,
        next: "wrap the entries in [ … ] and rerun.",
      },
    );
  }
  return value;
}

/**
 * @param {Store} store - The loaded content root.
 * @returns {Map<string, Record<string, unknown>[]>} A mutable copy of the files.
 */
function copyFiles(store) {
  return new Map([...store.files].map(([file, records]) => [file, [...records]]));
}

/** @type {CommandSpec} */
export const addSpec = {
  usage: "<file> [--replacing <id>] [--json]",
  flags: { replacing: "string", json: "boolean" },
  range: false,
  positionals: 1,
};

/**
 * `cards:add`: admit new cards from a writer's output.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code: 0 even when cards were dropped.
 */
export function runAdd(parsed, context) {
  const input = readArrayInput(parsed.positionals[0], "add", addSpec);
  const store = loadStore(context.root);
  const replacing = stringFlag(parsed, "replacing");
  if (
    replacing !== undefined &&
    !store.cards.some((entry) => entry.raw["id"] === replacing) &&
    !store.tombstones.some((tombstone) => tombstone.id === replacing)
  ) {
    throw usageError(
      "add",
      addSpec,
      `--replacing ${replacing} names no card or tombstone`,
    );
  }
  const env = { lists: store.lists, optionalFields: context.optionalFields };
  const taken = takenIds(store);
  const files = copyFiles(store);
  /** @type {Set<string>} */
  const touched = new Set();
  const pool = store.cards.flatMap((entry) => {
    const typed = asTyped(entry.raw);
    return typed === undefined || typed.id === replacing
      ? []
      : [{ ...typed, key: typed.id }];
  });
  const tombstones = store.tombstones
    .filter((tombstone) => tombstone.id !== replacing)
    .map((tombstone) => ({ ...tombstone, key: tombstone.id }));

  /** @type {{ index: number, id: string, topic: string, subtopic: string, level: number }[]} */
  const admitted = [];
  /** @type {{ index: number, ja: string, reasons: Reason[] }[]} */
  const dropped = [];
  for (const [index, value] of input.entries()) {
    const label = `input[${String(index)}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      dropped.push({
        index,
        ja: "",
        reasons: [{ rule: "INPUT", message: "not a card object" }],
      });
      continue;
    }
    const fields = /** @type {Record<string, unknown>} */ (value);
    const ja = typeof fields["ja"] === "string" ? fields["ja"] : "";
    const reserved = ["id", "createdAt", "stamps"].filter((key) => key in fields);
    if (reserved.length > 0) {
      dropped.push({
        index,
        ja,
        reasons: [{ rule: "INPUT", message: `must not carry ${reserved.join(", ")}` }],
      });
      continue;
    }
    const [id = ""] = freshIds(taken, 1, context.random);
    const card = orderCard(
      { ...fields, id, createdAt: context.today(), stamps: {} },
      optionalNames(context),
    );
    /** @type {Reason[]} */
    const reasons = lintCard(card, label, env, { requireStored: true }).map(
      ({ rule, message }) => ({
        rule,
        message,
      }),
    );
    const typed = asTyped(card);
    if (reasons.length === 0 && typed !== undefined) {
      const duplicates = findNearDuplicates(
        [{ ...typed, key: label }],
        pool,
        tombstones,
      );
      if (duplicates.length === 0) {
        const file = cardFile(typed.topic, typed.subtopic);
        files.set(file, [...(files.get(file) ?? []), card]);
        touched.add(file);
        pool.push({ ...typed, key: id });
        admitted.push({
          index,
          id,
          topic: typed.topic,
          subtopic: typed.subtopic,
          level: typed.level,
        });
        continue;
      }
      for (const pair of duplicates) {
        reasons.push({
          rule: "NEAR_DUPLICATE",
          message: `ja ${pair.ja.toFixed(2)} / en ${pair.en.toFixed(2)} with ${pair.b} (${pair.against})`,
        });
      }
    }
    taken.delete(id);
    dropped.push({ index, ja, reasons });
  }

  writeCardFiles(
    context.root,
    new Map([...touched].map((file) => [file, files.get(file) ?? []])),
    optionalNames(context),
    context.format,
  );

  if (flag(parsed, "json")) {
    printJson(context, { admitted, dropped });
    return 0;
  }
  for (const card of admitted) {
    context.out(
      `admitted ${card.id}  ${card.topic}/${card.subtopic} L${String(card.level)}`,
    );
  }
  for (const drop of dropped) {
    for (const reason of drop.reasons) {
      context.out(
        `dropped input[${String(drop.index)}]  ${reason.rule} ${reason.message}  ${drop.ja}`,
      );
    }
  }
  context.out(
    `cards:add: ${String(admitted.length)} admitted, ${String(dropped.length)} dropped`,
  );
  return 0;
}

/** @type {CommandSpec} */
export const updateSpec = {
  usage: "<file> [--json]",
  flags: { json: "boolean" },
  range: false,
  positionals: 1,
};

/**
 * `cards:update`: merge edited fields into existing cards.
 *
 * @remarks
 * Stamps are never touched: an edited core field no longer matches
 * `stamps.core.hash`, which is exactly what sends the card back to review.
 * A topic or subtopic retag moves the card to its new file under the same id.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code: 0 even when entries were rejected.
 */
export function runUpdate(parsed, context) {
  const input = readArrayInput(parsed.positionals[0], "update", updateSpec);
  const store = loadStore(context.root);
  const env = { lists: store.lists, optionalFields: context.optionalFields };
  const editable = new Set([...CORE_FIELDS, ...optionalNames(context)]);
  const files = copyFiles(store);
  /** @type {Set<string>} */
  const touched = new Set();
  const tombstoned = new Set(store.tombstones.map((tombstone) => tombstone.id));

  /** @type {{ id: string, fields: string[], movedFrom?: string }[]} */
  const updated = [];
  /** @type {{ id: string, reasons: Reason[] }[]} */
  const rejected = [];
  for (const [index, value] of input.entries()) {
    const id = Array.isArray(value) ? undefined : readKey(value, "id");
    if (typeof id !== "string") {
      rejected.push({
        id: `input[${String(index)}]`,
        reasons: [{ rule: "INPUT", message: 'each entry needs a string "id"' }],
      });
      continue;
    }
    const changes = /** @type {Record<string, unknown>} */ (value);
    const entry = store.cards.find((candidate) => candidate.raw["id"] === id);
    if (entry === undefined) {
      rejected.push({
        id,
        reasons: [
          {
            rule: "UNKNOWN_ID",
            message: tombstoned.has(id)
              ? "this id is tombstoned"
              : "no card has this id",
          },
        ],
      });
      continue;
    }
    /** @type {Reason[]} */
    const reasons = [];
    /** @type {string[]} */
    const cleared = [];
    /** @type {Record<string, unknown>} */
    const assigned = {};
    for (const [key, newValue] of Object.entries(changes)) {
      if (key === "id") continue;
      if (!editable.has(key)) {
        reasons.push({ rule: "INPUT", message: `"${key}" is not an editable field` });
      } else if (newValue !== null) {
        assigned[key] = newValue;
      } else if (CORE_FIELDS.some((core) => core === key)) {
        reasons.push({
          rule: "INPUT",
          message: `"${key}" is a core field and cannot be cleared`,
        });
      } else {
        cleared.push(key);
      }
    }
    /** @type {Record<string, unknown>} */
    const next = Object.fromEntries(
      Object.entries({ ...entry.raw, ...assigned }).filter(
        ([key]) => !cleared.includes(key),
      ),
    );
    if (reasons.length === 0) {
      reasons.push(
        ...lintCard(next, id, env, { requireStored: true }).map(
          ({ rule, message }) => ({
            rule,
            message,
          }),
        ),
      );
    }
    if (reasons.length > 0) {
      rejected.push({ id, reasons });
      continue;
    }

    const changed = [...editable].filter(
      (key) => JSON.stringify(entry.raw[key]) !== JSON.stringify(next[key]),
    );
    const from = entry.file;
    const to = cardFile(String(next["topic"]), String(next["subtopic"]));
    files.set(
      from,
      (files.get(from) ?? []).filter((record) => record !== entry.raw),
    );
    files.set(to, [...(files.get(to) ?? []), next]);
    touched.add(from);
    touched.add(to);
    // Later entries for the same id build on this one.
    entry.raw = next;
    entry.file = to;
    updated.push(
      from === to ? { id, fields: changed } : { id, fields: changed, movedFrom: from },
    );
  }

  writeCardFiles(
    context.root,
    new Map([...touched].map((file) => [file, files.get(file) ?? []])),
    optionalNames(context),
    context.format,
  );

  if (flag(parsed, "json")) {
    printJson(context, { updated, rejected });
    return 0;
  }
  for (const card of updated) {
    const fields = card.fields.length === 0 ? "(no change)" : card.fields.join(", ");
    const moved =
      card.movedFrom === undefined ? "" : `  moved from cards/${card.movedFrom}`;
    context.out(`updated ${card.id}  ${fields}${moved}`);
  }
  for (const card of rejected) {
    for (const reason of card.reasons) {
      context.out(`rejected ${card.id}  ${reason.rule} ${reason.message}`);
    }
  }
  context.out(
    `cards:update: ${String(updated.length)} updated, ${String(rejected.length)} rejected`,
  );
  return 0;
}

/** @type {CommandSpec} */
export const tombstoneSpec = {
  usage: '--id <id> --reason "<one line>" [--replaced-by <id>]',
  flags: { id: "string", reason: "string", "replaced-by": "string" },
  range: false,
  positionals: 0,
};

/**
 * `cards:tombstone`: delete a card and record it so its id is never reused.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runTombstone(parsed, context) {
  const id = stringFlag(parsed, "id");
  const reason = stringFlag(parsed, "reason")?.trim();
  const replacedBy = stringFlag(parsed, "replaced-by");
  if (id === undefined)
    throw usageError("tombstone", tombstoneSpec, "--id is required");
  if (reason === undefined || reason === "" || /[\r\n]/u.test(reason)) {
    throw usageError("tombstone", tombstoneSpec, "--reason must be one non-empty line");
  }
  const store = loadStore(context.root);
  const entry = entryById(store, id, "check the id with `pnpm cards:show --ids <id>`.");
  if (replacedBy !== undefined) {
    if (replacedBy === id) {
      throw usageError(
        "tombstone",
        tombstoneSpec,
        "--replaced-by names the card being deleted",
      );
    }
    entryById(
      store,
      replacedBy,
      "admit the replacement with `pnpm cards:add` first, then tombstone the old card.",
    );
  }

  const files = copyFiles(store);
  files.set(
    entry.file,
    (files.get(entry.file) ?? []).filter((record) => record !== entry.raw),
  );
  writeCardFiles(
    context.root,
    new Map([[entry.file, files.get(entry.file) ?? []]]),
    optionalNames(context),
    context.format,
  );
  const { ja, en, topic, subtopic, level } = entry.raw;
  /** @type {import("./store.mjs").Tombstone} */
  const tombstone = {
    id,
    ja: String(ja),
    en: String(en),
    topic: String(topic),
    subtopic: String(subtopic),
    level: typeof level === "number" && Number.isInteger(level) ? level : 0,
    reason,
    deletedAt: context.today(),
  };
  if (replacedBy !== undefined) tombstone.replacedBy = replacedBy;
  appendTombstones(context.root, [tombstone]);
  context.out(
    `tombstoned ${id}${replacedBy === undefined ? "" : ` → ${replacedBy}`}: ${reason}`,
  );
  return 0;
}

/** @type {CommandSpec} */
export const stampSpec = {
  usage: "--ids <id,…> [--field <name>]",
  flags: { ids: "ids", field: "string" },
  range: false,
  positionals: 0,
};

/**
 * `cards:stamp`: record that cards were reviewed as they stand.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 * @throws {CardsError} `ERR_CARDS_STAMP_REFUSED` after stamping the rest,
 *   when any card fails lint or lacks the field.
 */
export function runStamp(parsed, context) {
  const ids = idsFlag(parsed, "ids");
  if (ids === undefined || ids.length === 0)
    throw usageError("stamp", stampSpec, "--ids is required");
  const fieldFlag = stringFlag(parsed, "field");
  const name = fieldFlag === undefined ? "core" : declaredField(context, fieldFlag);
  const store = loadStore(context.root);
  const entries = entriesById(
    store,
    ids,
    "stamp only ids that `pnpm cards:queue --json` listed.",
  );
  const findings = findingsByCard(store, context);
  const files = copyFiles(store);
  /** @type {Set<string>} */
  const touched = new Set();
  /** @type {string[]} */
  const refused = [];

  for (const entry of entries) {
    const id = String(entry.raw["id"]);
    const typed = asTyped(entry.raw);
    const errors = findings.get(id) ?? [];
    if (typed === undefined || errors.length > 0) {
      refused.push(
        `${id} (${errors.map((finding) => finding.rule).join(", ") || "SHAPE"})`,
      );
      continue;
    }
    if (name !== "core" && !(name in entry.raw)) {
      refused.push(`${id} (no "${name}" to stamp)`);
      continue;
    }
    const stamps =
      typeof typed.stamps === "object" && typed.stamps !== null
        ? { ...typed.stamps }
        : {};
    const hash = name === "core" ? coreHash(typed) : fieldHash(entry.raw[name]);
    const stamped = {
      ...entry.raw,
      stamps: {
        ...stamps,
        [name]: {
          hash,
          perspectivesVersion: store.lists.perspectivesVersion,
          at: context.today(),
        },
      },
    };
    files.set(
      entry.file,
      (files.get(entry.file) ?? []).map((record) =>
        record === entry.raw ? stamped : record,
      ),
    );
    entry.raw = stamped;
    touched.add(entry.file);
    context.out(`stamped ${id} ${name}`);
  }

  writeCardFiles(
    context.root,
    new Map([...touched].map((file) => [file, files.get(file) ?? []])),
    optionalNames(context),
    context.format,
  );

  if (refused.length > 0) {
    throw new CardsError("ERR_CARDS_STAMP_REFUSED", "Some cards were not stamped.", {
      expected: "every listed card to pass `pnpm cards:lint`",
      actual: `refused: ${refused.join("; ")}`,
      next: "fix those cards through `reviewing-cards`, then stamp them; the others were stamped.",
    });
  }
  return 0;
}
