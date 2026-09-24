import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { API_ENV_NAMES } from "@instant-composition/api";

// `.env.example` is the one `.env*` file this repository tracks
// (`.gitignore`), and it lists every variable a local run of the stack reads —
// apps/api/src/env.ts's `API_ENV_NAMES`, which `pnpm dev` and the web client's
// Vite proxy read too. Nothing loads it: a local run takes these names from
// the shell. Nothing stops the two from drifting except this file: a variable
// added to apps/api/src/env.ts and forgotten here would leave the next person
// to discover it from the source.
//
// The scanner is deliberately not a dotenv parser. Adding a dependency to read
// six lines would cost more than it saves, and the shape asserted below --
// comments, blanks, and `NAME=value` -- is the whole grammar this file is
// allowed to use.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const envExamplePath = path.join(repoRoot, ".env.example");

/** One `NAME=value` assignment, or a line that is neither that nor a comment. */
interface ScannedEnvExample {
  /** Every assigned name, in the order the file lists them. */
  readonly names: string[];
  /** Every assigned value, keyed by name. */
  readonly values: Map<string, string>;
  /** `line N: <text>` for every line that is not blank, a comment, or an assignment. */
  readonly malformed: string[];
}

/** Reads `.env.example` into the three things the assertions below need. */
function scanEnvExample(): ScannedEnvExample {
  const names: string[] = [];
  const values = new Map<string, string>();
  const malformed: string[] = [];

  const lines = readFileSync(envExamplePath, "utf8").split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (assignment === null) {
      malformed.push(`line ${String(index + 1)}: ${line}`);
      continue;
    }
    names.push(assignment[1] ?? "");
    values.set(assignment[1] ?? "", assignment[2] ?? "");
  }

  return { names, values, malformed };
}

describe(".env.example", () => {
  it("uses only comments, blank lines and NAME=value assignments", () => {
    expect(scanEnvExample().malformed).toStrictEqual([]);
  });

  it("lists exactly the variables apps/api/src/env.ts declares", () => {
    const listed = [...scanEnvExample().names].sort();

    expect(listed).toStrictEqual([...API_ENV_NAMES].sort());
  });

  it("names each variable at most once", () => {
    const { names } = scanEnvExample();

    expect(names).toHaveLength(new Set(names).size);
  });

  it("ships no value, so a real credential can never be committed with it", () => {
    const withValues = [...scanEnvExample().values.entries()]
      .filter(([, value]) => value !== "")
      .map(([name]) => name);

    expect(withValues).toStrictEqual([]);
  });
});
