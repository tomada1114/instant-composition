import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { main } from "../scripts/cards/cli.mjs";

// A throwaway content root for the `cards:*` suites: small, hand-written tag
// lists rather than a copy of the real `content/`, so an edit to the real
// taxonomy or grammar list never changes what these tests expect. Nothing here
// asserts; the suites that import it do.

export interface Run {
  code: number;
  out: string;
  err: string;
}

export interface RunOptions {
  format?: (files: readonly string[]) => void;
  random?: (max: number) => number;
  today?: string;
  optionalFields?: readonly {
    name: string;
    check: (value: unknown) => string | undefined;
  }[];
}

const roots: string[] = [];

/** Word ranges per level, mirroring the shape of `content/levels.json`. */
const WORDS: readonly (readonly [number, number])[] = [
  [3, 8],
  [4, 9],
  [5, 11],
  [6, 13],
  [7, 15],
  [8, 17],
  [9, 19],
  [10, 22],
  [10, 24],
  [12, 28],
];

export const TAXONOMY = {
  version: 1,
  topics: [
    {
      id: "work",
      ja: "仕事",
      subtopics: [
        { id: "meetings", ja: "会議", scene: "会議で話す。" },
        { id: "requests", ja: "依頼", scene: "仕事を頼む。" },
      ],
    },
    {
      id: "daily",
      ja: "日常",
      subtopics: [{ id: "home", ja: "家", scene: "家で話す。" }],
    },
  ],
};

export const GRAMMAR = {
  version: 1,
  items: [
    {
      id: "imperatives",
      ja: "命令文",
      minLevel: 1,
      maxLevel: 4,
      example: "Let's take a short break.",
    },
    {
      id: "requests-permission",
      ja: "依頼と許可",
      minLevel: 2,
      maxLevel: 8,
      example: "Is it okay if I leave a bit early?",
    },
    {
      id: "past-simple",
      ja: "過去形",
      minLevel: 2,
      maxLevel: 6,
      example: "We missed the last train.",
    },
    {
      id: "present-perfect",
      ja: "現在完了",
      minLevel: 3,
      maxLevel: 10,
      example: "Have you finished the report yet?",
    },
  ],
};

/** Write a file under a content root, creating its directory. */
export function writeUnder(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A fresh content root with valid lists, no cards and no tombstones. */
export function makeContentRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cards-test-"));
  roots.push(root);
  writeUnder(root, "taxonomy.json", JSON.stringify(TAXONOMY));
  writeUnder(
    root,
    "levels.json",
    JSON.stringify({
      version: 1,
      note: "fixture",
      levels: WORDS.map(([min, max], index) => ({
        level: index + 1,
        toeic: "0",
        cefr: "A1",
        ielts: null,
        toeflIbt: "0",
        words: { min, max },
        summary: `level ${String(index + 1)}`,
      })),
    }),
  );
  writeUnder(root, "grammar.json", JSON.stringify(GRAMMAR));
  writeUnder(
    root,
    "guides/review-perspectives.md",
    "# Review perspectives\n\nperspectivesVersion: 2\n",
  );
  writeUnder(root, "tombstones.jsonl", "");
  return root;
}

/** Remove every content root made so far; call from `afterEach`. */
export function removeContentRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** A new-card input (no id, createdAt or stamps) with valid defaults. */
export function makeInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ja: "会議を始めましょう。",
    en: "Let's start the meeting.",
    alternatives: ["Shall we get started?", "Let's get going."],
    point: "Let's で誘う",
    topic: "work",
    subtopic: "meetings",
    level: 1,
    grammar: ["imperatives"],
    ...overrides,
  };
}

/** A stored card with valid defaults and no stamps. */
export function makeCard(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, ...makeInput(), createdAt: "2026-09-01", stamps: {}, ...overrides };
}

/** Write cards straight into a card file, bypassing the commands. */
export function writeCards(
  root: string,
  file: string,
  cards: readonly Record<string, unknown>[],
): void {
  writeUnder(root, `cards/${file}`, `${JSON.stringify(cards, null, 2)}\n`);
}

/** Write a command's JSON input file into the root and return its path. */
export function writeInput(root: string, name: string, value: unknown): string {
  const file = path.join(root, "input", name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  return file;
}

/** Run one `cards:*` command in-process against a content root. */
export function runCards(root: string, argv: string[], options: RunOptions = {}): Run {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, {
    root,
    out: (text: string) => {
      out.push(text);
    },
    err: (text: string) => {
      err.push(text);
    },
    today: () => options.today ?? "2026-09-22",
    format: options.format ?? (() => undefined),
    ...(options.random === undefined ? {} : { random: options.random }),
    ...(options.optionalFields === undefined
      ? {}
      : { optionalFields: options.optionalFields }),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** Parse a command's `--json` stdout. */
export function jsonOut(run: Run): unknown {
  return JSON.parse(run.out) as unknown;
}
