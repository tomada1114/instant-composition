import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

// `apps/web/src/openapi/` is generated from the contract's OpenAPI document by
// @hey-api/openapi-ts and committed. This suite is the generator: it writes
// the output into a temporary directory and holds every committed file to it,
// so a contract change that nobody regenerated fails here, and so does a hand
// edit of a generated file. `pnpm web:client` runs it with `--update`, which
// is the one way to rewrite them; CI runs vitest with CI set, where a missing
// or different file fails rather than being written.
//
// Only the `@hey-api/typescript` plugin runs. The SDK plugin needs the
// generator's bundled fetch client, whose source does not compile under this
// repository's `exactOptionalPropertyTypes` (ADR-0008); `apps/web/src/lib/
// endpoints.ts` makes the calls, typed by what this writes.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const committed = path.join(repoRoot, "apps/web/src/openapi");
const input = path.join(repoRoot, "packages/contracts/openapi.json");
const output = mkdtempSync(path.join(tmpdir(), "web-openapi-"));

afterAll(() => {
  rmSync(output, { recursive: true, force: true });
});

interface Generator {
  readonly createClient: (config: unknown) => Promise<unknown>;
}

/**
 * The generator, resolved from `apps/web`, which is the package that declares
 * it: the root does not, so a bare import from here would not resolve. Its
 * `exports` offers only an `import` condition, which `require.resolve` cannot
 * follow, so the entry is read off the manifest it does export.
 */
async function generator(): Promise<Generator> {
  const require = createRequire(path.join(repoRoot, "apps/web/package.json"));
  const manifestPath = require.resolve("@hey-api/openapi-ts/package.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = (manifest as { exports?: { ".": { import?: unknown } } }).exports?.["."]
    .import;
  if (typeof entry !== "string") {
    throw new TypeError("@hey-api/openapi-ts's manifest names no import entry.");
  }
  const url = pathToFileURL(path.join(path.dirname(manifestPath), entry)).href;
  return (await import(url)) as Generator;
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();
}

describe("the generated OpenAPI types under apps/web/src/openapi", () => {
  it("are exactly what the generator writes from packages/contracts/openapi.json", async () => {
    const { createClient } = await generator();
    await createClient({
      input,
      output: { path: output },
      plugins: ["@hey-api/typescript"],
      logs: { file: false, level: "silent" },
    });
    const generated = filesUnder(output);
    expect(generated).toStrictEqual(["index.ts", "types.gen.ts"]);
    for (const file of generated) {
      await expect(readFileSync(path.join(output, file), "utf8")).toMatchFileSnapshot(
        path.join(committed, file),
      );
    }
    expect(filesUnder(committed)).toStrictEqual(generated);
  });
});
