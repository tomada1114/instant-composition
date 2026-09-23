import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { err, ok, type Result } from "../../core/result";
import type { CardContent, TombstoneMeta, TopicInfo } from "../../core/types";
import { parseCard, parseLevels, parseTaxonomy, parseTombstone } from "./parse";

/** Everything read from a content root at one moment. */
export interface ContentSnapshot {
  readonly topics: readonly TopicInfo[];
  readonly toeicByLevel: ReadonlyMap<number, string>;
  /** Cards whose review stamp matches: the only ones a round may deal. */
  readonly shown: ReadonlyMap<string, CardContent>;
  /** Every well-formed card, reviewed or not. */
  readonly known: ReadonlyMap<string, CardContent>;
  readonly tombstones: ReadonlyMap<string, TombstoneMeta>;
  /** Cards (or whole files) left out because they did not parse. */
  readonly skipped: number;
}

export interface ContentError {
  readonly code: "ERR_CONTENT_UNREADABLE";
  readonly file: string;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** Card files under `cards/`, relative to the root, sorted. */
function cardFiles(root: string): string[] {
  const directory = path.join(root, "cards");
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join("cards", name))
    .sort();
}

/**
 * A string that changes whenever a file the snapshot is read from changes:
 * each file's path, size and modification time.
 */
export function contentSignature(root: string): string {
  const files = [
    "taxonomy.json",
    "levels.json",
    "tombstones.jsonl",
    ...cardFiles(root),
  ];
  return files
    .map((file) => {
      const absolute = path.join(root, file);
      if (!existsSync(absolute)) {
        return `${file}:-`;
      }
      const stat = statSync(absolute);
      return `${file}:${String(stat.size)}:${String(stat.mtimeMs)}`;
    })
    .join("|");
}

function readTombstones(root: string): Map<string, TombstoneMeta> {
  const file = path.join(root, "tombstones.jsonl");
  const tombstones = new Map<string, TombstoneMeta>();
  if (!existsSync(file)) {
    return tombstones;
  }
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    const tombstone = parseTombstone(value);
    if (tombstone !== undefined) {
      tombstones.set(tombstone.id, tombstone);
    }
  }
  return tombstones;
}

/**
 * Reads a content root, leaving out what does not parse rather than failing:
 * another checkout may be half-way through writing a card file.
 */
export function loadContent(root: string): Result<ContentSnapshot, ContentError> {
  const topics = parseTaxonomy(readJson(path.join(root, "taxonomy.json")));
  if (topics === undefined) {
    return err({ code: "ERR_CONTENT_UNREADABLE", file: "taxonomy.json" });
  }
  const toeicByLevel = parseLevels(readJson(path.join(root, "levels.json")));
  if (toeicByLevel === undefined) {
    return err({ code: "ERR_CONTENT_UNREADABLE", file: "levels.json" });
  }

  const shown = new Map<string, CardContent>();
  const known = new Map<string, CardContent>();
  let skipped = 0;
  for (const file of cardFiles(root)) {
    const cards = readJson(path.join(root, file));
    if (!Array.isArray(cards)) {
      skipped += 1;
      continue;
    }
    for (const value of cards) {
      const parsed = parseCard(value);
      if (parsed === undefined) {
        skipped += 1;
        continue;
      }
      known.set(parsed.card.id, parsed.card);
      if (parsed.shown) {
        shown.set(parsed.card.id, parsed.card);
      }
    }
  }

  return ok({
    topics,
    toeicByLevel,
    shown,
    known,
    tombstones: readTombstones(root),
    skipped,
  });
}
