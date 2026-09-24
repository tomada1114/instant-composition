import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// `pnpm api` runs apps/api's TypeScript source on Node's own type stripping,
// through scripts/ts-hooks.mjs. This loads the API's whole module graph —
// every workspace package it reaches — the same way, so a module Node cannot
// strip (an `enum`, a parameter property) or an import the hook cannot resolve
// fails here rather than at the first local run. DynamoDB is never touched:
// only `main.ts` connects, and it is not loaded.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("the API's source on Node's type stripping", () => {
  it("loads every module the API reaches, without a warning", () => {
    const probe = [
      `const api = await import(${JSON.stringify(path.join(repoRoot, "apps/api/src/index.ts"))});`,
      "process.stdout.write(typeof api.createApp);",
    ].join("\n");
    const run = spawnSync(
      process.execPath,
      ["--import", "./scripts/ts-hooks.mjs", "--input-type=module", "--eval", probe],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("function");
    expect(run.status).toBe(0);
  });
});
