// The commands that write vocabulary cards, run as `pnpm cards:<command>
// --kind vocab`: add, update, tombstone, stamp. Each holds the one lock the
// drill's write commands hold, loads the whole content root, and writes back
// only the vocab/ files it touched.
import { readKey } from "../lib/json.mjs";
import { flag, idsFlag, stringFlag, usageError } from "./args.mjs";
import { partitionIds, readInput, vocabSource } from "./common.mjs";
import { CardsError } from "./errors.mjs";
import { freshIds } from "./inspect.mjs";
import { fieldHash } from "./schema.mjs";
import {
  appendTombstones,
  loadStore,
  orderVocabCard,
  vocabFile,
  withLock,
  writeVocabFiles,
} from "./store.mjs";
import {
  meaningLanguage,
  takenVocabIds,
  vocabFindingsByCard,
} from "./vocab-inspect.mjs";
import { findHeadwordDuplicates, lintVocabCard } from "./vocab-rules.mjs";
import {
  asTypedVocab,
  meaningStamp,
  randomVocabId,
  VOCAB_CORE_FIELDS,
  vocabCoreHash,
} from "./vocab-schema.mjs";

/**
 * @typedef {import("./common.mjs").Context} Context
 * @typedef {import("./args.mjs").Parsed} Parsed
 * @typedef {import("./args.mjs").CommandSpec} CommandSpec
 * @typedef {import("./store.mjs").Store} Store
 */

/**
 * @typedef {object} Reason
 * @property {string} rule
 * @property {string} message
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
 * @returns {Map<string, Record<string, unknown>[]>} A mutable copy of the
 *   vocabulary files.
 */
function copyFiles(store) {
  return new Map([...store.vocabFiles].map(([file, records]) => [file, [...records]]));
}

/**
 * @param {Context} context - Environment.
 * @param {Map<string, Record<string, unknown>[]>} files - Every file's cards.
 * @param {ReadonlySet<string>} touched - The files to write.
 * @returns {void}
 */
function writeTouched(context, files, touched) {
  writeVocabFiles(
    context.root,
    new Map([...touched].map((file) => [file, files.get(file) ?? []])),
    context.formatter,
  );
}

/** @type {CommandSpec} */
export const vocabAddSpec = {
  usage: "--kind vocab <file> [--replacing <id>] [--dry-run] [--json]",
  flags: { replacing: "string", "dry-run": "boolean", json: "boolean" },
  range: false,
  vocab: true,
  positionals: 1,
};

/**
 * `cards:add --kind vocab`: admit new vocabulary cards from a writer's
 * output. A card that fails lint, or whose headword a card or tombstone in
 * its category already has, is dropped.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code: 0 even when cards were dropped.
 */
export function runVocabAdd(parsed, context) {
  context.formatter.ready();
  return withLock(context.root, context.err, () => addLocked(parsed, context));
}

/**
 * The body of `cards:add --kind vocab`, run while the lock is held.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
function addLocked(parsed, context) {
  const input = readArrayInput(parsed.positionals[0], "add", vocabAddSpec);
  const store = loadStore(context.root);
  const replacing = stringFlag(parsed, "replacing");
  if (
    replacing !== undefined &&
    !store.vocab.some((entry) => entry.raw["id"] === replacing) &&
    !store.vocabTombstones.some((tombstone) => tombstone.id === replacing)
  ) {
    throw usageError(
      "add",
      vocabAddSpec,
      `--replacing ${replacing} names no vocab card or tombstone`,
    );
  }
  const taken = takenVocabIds(store);
  const files = copyFiles(store);
  /** @type {Set<string>} */
  const touched = new Set();
  const pool = store.vocab.flatMap((entry) => {
    const card = asTypedVocab(entry.raw);
    return card === undefined || card.id === replacing
      ? []
      : [{ key: card.id, category: card.category, headword: card.headword }];
  });
  const tombstones = store.vocabTombstones
    .filter((tombstone) => tombstone.id !== replacing)
    .map((tombstone) => ({ ...tombstone, key: tombstone.id }));

  /** @type {{ index: number, id: string, category: string, level: number }[]} */
  const admitted = [];
  /** @type {{ index: number, headword: string, reasons: Reason[] }[]} */
  const dropped = [];
  for (const [index, value] of input.entries()) {
    const label = `input[${String(index)}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      dropped.push({
        index,
        headword: "",
        reasons: [{ rule: "INPUT", message: "not a card object" }],
      });
      continue;
    }
    const fields = /** @type {Record<string, unknown>} */ (value);
    const headword = typeof fields["headword"] === "string" ? fields["headword"] : "";
    const reserved = ["id", "createdAt", "stamps"].filter((key) => key in fields);
    if (reserved.length > 0) {
      dropped.push({
        index,
        headword,
        reasons: [{ rule: "INPUT", message: `must not carry ${reserved.join(", ")}` }],
      });
      continue;
    }
    const [id = ""] = freshIds(taken, 1, context.random, randomVocabId);
    const card = orderVocabCard({
      ...fields,
      id,
      createdAt: context.today(),
      stamps: {},
    });
    /** @type {Reason[]} */
    const reasons = lintVocabCard(card, label, store.lists, {
      requireStored: true,
    }).map(({ rule, message }) => ({ rule, message }));
    const typed = asTypedVocab(card);
    if (reasons.length === 0 && typed !== undefined) {
      const subject = {
        key: label,
        category: typed.category,
        headword: typed.headword,
      };
      const duplicates = findHeadwordDuplicates([subject], pool, tombstones);
      if (duplicates.length === 0) {
        const file = vocabFile(typed.category);
        files.set(file, [...(files.get(file) ?? []), card]);
        touched.add(file);
        pool.push({ ...subject, key: id });
        admitted.push({ index, id, category: typed.category, level: typed.level });
        continue;
      }
      for (const pair of duplicates) {
        reasons.push({
          rule: "DUPLICATE",
          message: `same headword in ${typed.category} as ${pair.b} (${pair.against})`,
        });
      }
    }
    taken.delete(id);
    dropped.push({ index, headword, reasons });
  }

  if (!flag(parsed, "dry-run")) writeTouched(context, files, touched);

  if (flag(parsed, "json")) {
    printJson(context, { admitted, dropped });
    return 0;
  }
  for (const card of admitted) {
    context.out(`admitted ${card.id}  ${card.category} L${String(card.level)}`);
  }
  for (const drop of dropped) {
    for (const reason of drop.reasons) {
      context.out(
        `dropped input[${String(drop.index)}]  ${reason.rule} ${reason.message}  ${drop.headword}`,
      );
    }
  }
  context.out(
    `cards:add: ${String(admitted.length)} admitted, ${String(dropped.length)} dropped`,
  );
  return 0;
}

/** @type {CommandSpec} */
export const vocabUpdateSpec = {
  usage: "--kind vocab <file> [--json]",
  flags: { json: "boolean" },
  range: false,
  vocab: true,
  positionals: 1,
};

/**
 * `cards:update --kind vocab`: merge edited fields into existing vocabulary
 * cards.
 *
 * @remarks
 * Stamps are never touched, so an edited core field or meaning goes back to
 * review. `meanings` merges by language: `{ "ja": "…" }` sets one meaning and
 * leaves the others, and `{ "ja": null }` removes it. A category retag moves
 * the card to its new file under the same id.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code: 0 even when entries were rejected.
 */
export function runVocabUpdate(parsed, context) {
  context.formatter.ready();
  return withLock(context.root, context.err, () => updateLocked(parsed, context));
}

/**
 * Apply one entry's changes to a card.
 *
 * @param {Record<string, unknown>} raw - The card as stored.
 * @param {Record<string, unknown>} changes - The entry.
 * @returns {{ next: Record<string, unknown>, reasons: Reason[] }} The edited
 *   card, and why the entry cannot be applied.
 */
function applyChanges(raw, changes) {
  /** @type {readonly string[]} */
  const core = VOCAB_CORE_FIELDS;
  /** @type {Reason[]} */
  const reasons = [];
  /** @type {Record<string, unknown>} */
  const next = { ...raw };
  for (const [key, value] of Object.entries(changes)) {
    if (key === "id") continue;
    if (core.includes(key)) {
      if (value === null) {
        reasons.push({
          rule: "INPUT",
          message: `"${key}" is a core field and cannot be cleared`,
        });
      } else {
        next[key] = value;
      }
    } else if (key === "meanings") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        reasons.push({
          rule: "INPUT",
          message: '"meanings" must be an object keyed by language',
        });
        continue;
      }
      const current = raw["meanings"];
      /** @type {Record<string, unknown>} */
      const merged = {
        ...(typeof current === "object" && current !== null && !Array.isArray(current)
          ? current
          : {}),
        ...value,
      };
      next["meanings"] = Object.fromEntries(
        Object.entries(merged).filter(([, meaning]) => meaning !== null),
      );
    } else {
      reasons.push({ rule: "INPUT", message: `"${key}" is not an editable field` });
    }
  }
  return { next, reasons };
}

/**
 * The body of `cards:update --kind vocab`, run while the lock is held.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
function updateLocked(parsed, context) {
  const input = readArrayInput(parsed.positionals[0], "update", vocabUpdateSpec);
  const store = loadStore(context.root);
  const files = copyFiles(store);
  /** @type {Set<string>} */
  const touched = new Set();
  const tombstoned = new Set(store.vocabTombstones.map((tombstone) => tombstone.id));
  const editable = [...VOCAB_CORE_FIELDS, "meanings"];

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
    const entry = store.vocab.find((candidate) => candidate.raw["id"] === id);
    if (entry === undefined) {
      rejected.push({
        id,
        reasons: [
          {
            rule: "UNKNOWN_ID",
            message: tombstoned.has(id)
              ? "this id is tombstoned"
              : "no vocab card has this id",
          },
        ],
      });
      continue;
    }
    const { next, reasons } = applyChanges(
      entry.raw,
      /** @type {Record<string, unknown>} */ (value),
    );
    if (reasons.length === 0) {
      reasons.push(
        ...lintVocabCard(next, id, store.lists, { requireStored: true }).map(
          ({ rule, message }) => ({ rule, message }),
        ),
      );
    }
    if (reasons.length > 0) {
      rejected.push({ id, reasons });
      continue;
    }
    const changed = editable.filter(
      (key) => JSON.stringify(entry.raw[key]) !== JSON.stringify(next[key]),
    );
    const from = entry.file;
    const to = vocabFile(String(next["category"]));
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

  writeTouched(context, files, touched);

  if (flag(parsed, "json")) {
    printJson(context, { updated, rejected });
    return 0;
  }
  for (const card of updated) {
    const fields = card.fields.length === 0 ? "(no change)" : card.fields.join(", ");
    const moved =
      card.movedFrom === undefined ? "" : `  moved from vocab/${card.movedFrom}`;
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
export const vocabTombstoneSpec = {
  usage: '--kind vocab --id <id> --reason "<one line>" [--replaced-by <id>]',
  flags: { id: "string", reason: "string", "replaced-by": "string" },
  range: false,
  vocab: true,
  positionals: 0,
};

/**
 * `cards:tombstone --kind vocab`: delete a vocabulary card and record it, with
 * `kind: "vocab"`, so its id is never reused.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
export function runVocabTombstone(parsed, context) {
  context.formatter.ready();
  return withLock(context.root, context.err, () => tombstoneLocked(parsed, context));
}

/**
 * The body of `cards:tombstone --kind vocab`, run while the lock is held.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
function tombstoneLocked(parsed, context) {
  const id = stringFlag(parsed, "id");
  const reason = stringFlag(parsed, "reason")?.trim();
  const replacedBy = stringFlag(parsed, "replaced-by");
  if (id === undefined)
    throw usageError("tombstone", vocabTombstoneSpec, "--id is required");
  if (reason === undefined || reason === "" || /[\r\n]/u.test(reason)) {
    throw usageError(
      "tombstone",
      vocabTombstoneSpec,
      "--reason must be one non-empty line",
    );
  }
  const store = loadStore(context.root);
  const entry = store.vocab.find((candidate) => candidate.raw["id"] === id);
  const already = store.vocabTombstones.some((tombstone) => tombstone.id === id);
  if (entry === undefined && already) {
    context.out(`already tombstoned ${id}`);
    return 0;
  }
  if (entry === undefined) {
    throw new CardsError("ERR_CARDS_UNKNOWN_ID", `No vocab card has the id ${id}.`, {
      expected: "the id of a card under vocab/",
      actual: `${id} does not exist`,
      next: "check the id with `pnpm cards:show --kind vocab --ids <id>`.",
    });
  }
  if (replacedBy !== undefined) {
    if (replacedBy === id) {
      throw usageError(
        "tombstone",
        vocabTombstoneSpec,
        "--replaced-by names the card being deleted",
      );
    }
    if (!store.vocab.some((candidate) => candidate.raw["id"] === replacedBy)) {
      throw new CardsError(
        "ERR_CARDS_UNKNOWN_ID",
        `No vocab card has the id ${replacedBy}.`,
        {
          expected: "the id of a card under vocab/",
          actual: `${replacedBy} does not exist`,
          next: "admit the replacement with `pnpm cards:add --kind vocab` first, then tombstone the old card.",
        },
      );
    }
  }

  // The tombstone goes first, as for a drill card: a rerun after a crash
  // finds it and only removes the card.
  if (!already) {
    const { category, level, headword } = entry.raw;
    /** @type {import("./store.mjs").VocabTombstone} */
    const tombstone = {
      kind: "vocab",
      id,
      category: String(category),
      level: typeof level === "number" && Number.isInteger(level) ? level : 0,
      headword: String(headword),
      reason,
      deletedAt: context.today(),
    };
    if (replacedBy !== undefined) tombstone.replacedBy = replacedBy;
    appendTombstones(context.root, [tombstone]);
  }
  const files = copyFiles(store);
  files.set(
    entry.file,
    (files.get(entry.file) ?? []).filter((record) => record !== entry.raw),
  );
  writeTouched(context, files, new Set([entry.file]));
  context.out(
    `tombstoned ${id}${replacedBy === undefined ? "" : ` → ${replacedBy}`}: ${reason}`,
  );
  return 0;
}

/** @type {CommandSpec} */
export const vocabStampSpec = {
  usage: "--kind vocab --ids <id,…> [--field meanings.<lang>]",
  flags: { ids: "ids", field: "string" },
  range: false,
  vocab: true,
  positionals: 0,
};

/**
 * `cards:stamp --kind vocab`: record that vocabulary cards were reviewed as
 * they stand. Without `--field` it stamps the core and every meaning the card
 * holds; `--field meanings.<lang>` stamps that one meaning alone, for a
 * language added after the card was reviewed.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 * @throws {CardsError} `ERR_CARDS_STAMP_REFUSED` after stamping the rest,
 *   when any card fails lint or lacks the meaning.
 */
export function runVocabStamp(parsed, context) {
  context.formatter.ready();
  return withLock(context.root, context.err, () => stampLocked(parsed, context));
}

/**
 * The body of `cards:stamp --kind vocab`, run while the lock is held.
 *
 * @param {Parsed} parsed - Arguments.
 * @param {Context} context - Environment.
 * @returns {number} Exit code.
 */
function stampLocked(parsed, context) {
  const ids = idsFlag(parsed, "ids");
  if (ids === undefined || ids.length === 0)
    throw usageError("stamp", vocabStampSpec, "--ids is required");
  const only = meaningLanguage(
    stringFlag(parsed, "field"),
    "rerun without --field to stamp the core and every meaning.",
  );
  const store = loadStore(context.root);
  const { entries, unknown } = partitionIds(vocabSource(store), ids);
  const findings = vocabFindingsByCard(store);
  const files = copyFiles(store);
  /** @type {Set<string>} */
  const touched = new Set();
  /** @type {string[]} */
  const refused = unknown.map(({ id, reason }) => `${id} (${reason})`);
  /** @type {string[]} */
  const done = [];
  const stamp = (/** @type {string} */ hash) => ({
    hash,
    perspectivesVersion: store.lists.vocabPerspectivesVersion,
    at: context.today(),
  });

  for (const entry of entries) {
    const id = String(entry.raw["id"]);
    const card = asTypedVocab(entry.raw);
    const errors = findings.get(id) ?? [];
    if (card === undefined || errors.length > 0) {
      refused.push(
        `${id} (${errors.map((finding) => finding.rule).join(", ") || "SHAPE"})`,
      );
      continue;
    }
    const meaning = only === undefined ? undefined : card.meanings[only];
    if (only !== undefined && meaning === undefined) {
      refused.push(`${id} (no "${meaningStamp(only)}" to stamp)`);
      continue;
    }
    /** @type {Record<string, unknown>} */
    const stamps =
      typeof card.stamps === "object" && card.stamps !== null ? { ...card.stamps } : {};
    /** @type {string[]} */
    const names = [];
    if (only === undefined) {
      stamps["core"] = stamp(vocabCoreHash(card));
      names.push("core");
      for (const [lang, text] of Object.entries(card.meanings)) {
        stamps[meaningStamp(lang)] = stamp(fieldHash(text));
        names.push(meaningStamp(lang));
      }
    } else {
      stamps[meaningStamp(only)] = stamp(fieldHash(meaning));
      names.push(meaningStamp(only));
    }
    const stamped = { ...entry.raw, stamps };
    files.set(
      entry.file,
      (files.get(entry.file) ?? []).map((record) =>
        record === entry.raw ? stamped : record,
      ),
    );
    entry.raw = stamped;
    touched.add(entry.file);
    done.push(`stamped ${id} ${names.join(", ")}`);
  }

  writeTouched(context, files, touched);

  for (const line of done) context.out(line);
  if (refused.length > 0) {
    throw new CardsError("ERR_CARDS_STAMP_REFUSED", "Some cards were not stamped.", {
      expected:
        "every listed id to be a vocab card that passes `pnpm cards:lint --kind vocab`",
      actual: `refused: ${refused.join("; ")}`,
      next: "fix those cards with `pnpm cards:update --kind vocab`, then stamp them; the others were stamped.",
    });
  }
  return 0;
}
