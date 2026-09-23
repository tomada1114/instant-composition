import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// `eslint.config.mjs` states the zone edges as `no-restricted-imports`
// patterns; this file asserts the same edges from the module graph itself, so
// a rule deleted from that config still fails the suite. The two are checked
// independently on purpose — a boundary that only one layer holds is a
// boundary one edit removes.
//
// The scanner below is deliberately not a TypeScript parser, for the same
// reason `tests/workflows.test.ts` does not parse YAML: a parser would be a new
// dependency for a repository whose point is a small, reviewable dependency
// surface, and what is asserted here is the specifier *as written*, which is
// exactly what survives comment-stripping and nothing more.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// --- scanning ----------------------------------------------------------------

/**
 * Remove every comment, so a path named in TSDoc prose is not read as an
 * import.
 *
 * @remarks
 * Block comments go first: a `//` inside one would otherwise be treated as the
 * start of a line comment and swallow the rest of that line only, leaving the
 * comment's closing delimiter behind. Nothing under `src/` contains a `//`
 * inside a string literal today, and {@link SCANNER_CONTROL} pins the scanner's
 * output against a hand-written expectation so a source that did would show up
 * as a failure here rather than as a boundary silently going unchecked.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Every module specifier `source` imports, re-exports, or `import()`s.
 *
 * @remarks
 * The four spellings this repository can produce are covered in one pattern:
 * `from "x"` (a static import or a re-export), a side-effect `import "x"`, a
 * dynamic `import("x")`, and `require("x")`.
 */
function importSpecifiers(source: string): string[] {
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g;
  return [...withoutComments(source).matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Every `.ts`/`.tsx` file under `directory`, as repo-relative POSIX paths. */
function modulesUnder(directory: string): string[] {
  const absolute = path.join(repoRoot, directory);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return modulesUnder(relative);
    }
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  });
}

/**
 * The repo-relative module a specifier names, or `undefined` for a package.
 *
 * @remarks
 * Two spellings reach a module of this repository's own. A relative one is
 * resolved against the importer's directory. An `@/…` one goes through the
 * alias `tsconfig.json` maps to `./src/*`, so it is resolved against `src/`
 * whatever the importer's depth — without this branch every zone assertion
 * below would silently stop seeing an aliased import, which is the shape
 * shadcn/ui writes and the reason the alias exists at all.
 */
function resolveWithin(module: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) {
    return path.posix.normalize(path.posix.join("src", specifier.slice("@/".length)));
  }
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(module), specifier));
}

/** Whether `specifier` reaches `pkg` — the package itself or any subpath. */
function importsPackage(specifier: string, pkg: string): boolean {
  return specifier === pkg || specifier.startsWith(`${pkg}/`);
}

interface Module {
  /** Repo-relative POSIX path, e.g. `src/server/env.ts`. */
  readonly file: string;
  readonly specifiers: readonly string[];
}

const sourceModules: readonly Module[] = modulesUnder("src")
  .sort()
  .map((file) => ({
    file,
    specifiers: importSpecifiers(readFileSync(path.join(repoRoot, file), "utf8")),
  }));

function modulesIn(...zones: readonly string[]): Module[] {
  return sourceModules.filter((module) =>
    zones.some((zone) => module.file.startsWith(`${zone}/`)),
  );
}

// --- the scanner itself ------------------------------------------------------

// A boundary test whose scanner quietly finds nothing passes forever while
// enforcing nothing, so the scanner is pinned before the zones are asserted
// with it. Every case that could silence it is here: a specifier inside a
// block comment, one inside a line comment, and one inside an ordinary string.
const SCANNER_CONTROL = `
import defaultExport from "next";
import { named } from "../core/result";
import "./globals.css";
import type { OnlyAType } from "@radix-ui/react-slot";
import { aliased } from "@/core/result";
export { re } from "./errors";
const lazy = await import("../i18n/locales");
const legacy = require("node:fs");
const message = "imported from ../server/env by hand";
// import { commented } from "./line-comment-only";
/* import { blocked } from "./block-comment-only"; */
`;

/**
 * Modules the walk has to come back with, chosen for the shapes they cover.
 *
 * @remarks
 * A named subset rather than the whole tree: enumerating every module made the
 * suite fail on each legal new file, which teaches its reader to edit the
 * expectation. Each entry earns its place — two directories deep (the
 * recursion), a `.tsx` inside a bracketed segment (the extension filter and the
 * directory name), a zone holding exactly one module, a file at the root of
 * `src/`, and a module in the server zone. What the
 * exhaustive list was really standing in for — a scan that quietly found
 * nothing — is asserted directly by this and by the zone-coverage case below.
 */
const SCAN_ANCHORS = [
  "src/app/[locale]/page.tsx",
  "src/components/ui/button.tsx",
  "src/core/result.ts",
  "src/proxy.ts",
  "src/server/env.ts",
];

describe("the import scanner the zone assertions run on", () => {
  it("finds every spelling of an import and nothing that only looks like one", () => {
    expect(importSpecifiers(SCANNER_CONTROL)).toStrictEqual([
      "next",
      "../core/result",
      "./globals.css",
      "@radix-ui/react-slot",
      "@/core/result",
      "./errors",
      "../i18n/locales",
      "node:fs",
    ]);
  });

  it.each([
    ["src/server/env.ts", ["server-only", "zod"]],
    [
      "src/components/ui/button.tsx",
      [
        "@radix-ui/react-slot",
        "class-variance-authority",
        "react",
        "@/components/lib/utils",
      ],
    ],
  ])("reads %s as %p", (file, expected) => {
    const module = sourceModules.find((candidate) => candidate.file === file);
    expect(module?.specifiers).toStrictEqual(expected);
  });

  it("reaches every anchor, so the walk is not stuck in a subdirectory of src/", () => {
    expect(sourceModules.map((module) => module.file)).toEqual(
      expect.arrayContaining(SCAN_ANCHORS),
    );
  });

  // `arrayContaining` above only proves presence: it would still pass if
  // `modulesUnder`'s `/\.tsx?$/` filter were dropped and every `.css` or
  // binary file under `src/` joined `sourceModules` too. This is the
  // assertion the old exhaustive `toStrictEqual` list stood in for — that the
  // filter actually excludes something — asserted directly instead of by
  // enumerating every file the walk must return.
  it("returns nothing but .ts and .tsx files", () => {
    expect(sourceModules.every((module) => /\.tsx?$/.test(module.file))).toBe(true);
  });

  it("resolves a relative specifier to the module it names", () => {
    expect(resolveWithin("src/app/[locale]/page.tsx", "../../i18n/locales")).toBe(
      "src/i18n/locales",
    );
    expect(resolveWithin("src/components/ui/button.tsx", "./../lib/utils")).toBe(
      "src/components/lib/utils",
    );
    expect(resolveWithin("src/core/result.ts", "next")).toBeUndefined();
  });

  it("resolves an @/ specifier against src/, from any depth, and no package name", () => {
    expect(
      resolveWithin("src/components/ui/button.tsx", "@/components/lib/utils"),
    ).toBe("src/components/lib/utils");
    expect(resolveWithin("src/app/[locale]/page.tsx", "@/server/env")).toBe(
      "src/server/env",
    );
    // The whole point of the `@/` branch: the same specifier resolves to the
    // same module whatever file names it, which a `../` one cannot do.
    expect(resolveWithin("src/core/result.ts", "@/server/env")).toBe("src/server/env");
    // A scoped package is `@scope/name` and an empty scope is not legal, so
    // nothing a registry publishes can be mistaken for an aliased path.
    expect(resolveWithin("src/core/result.ts", "@radix-ui/react-slot")).toBeUndefined();
  });
});

// --- the zone edges ----------------------------------------------------------

/**
 * Every zone under `src/`, and the zones a module in it may not import.
 *
 * @remarks
 * AGENTS.md's `app → server → core` written as a table, with
 * `app → components → core` beside it and `i18n` the leaf the page tree, the
 * components and the handlers read. A zone added to `src/` has to be
 * given a row here before this suite passes, which is the review the table
 * exists to force. `eslint.config.mjs` states the same edges as
 * `no-restricted-imports` groups; the two layers are checked independently, so
 * a rule deleted there still fails here.
 *
 * `src/components` is named in the other rows as well as carrying its own: a
 * boundary only one side states is one a single edit removes, so the zones
 * below it name it and it names them.
 */
const FORBIDDEN_ZONE_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  "src/app": [],
  "src/components": ["src/app", "src/server"],
  "src/core": ["src/app", "src/components", "src/i18n", "src/server"],
  "src/i18n": ["src/app", "src/components", "src/server"],
  "src/server": ["src/app", "src/components"],
};

/** Whether `resolved` is `zone` itself or a module inside it. */
function inZone(resolved: string, zone: string): boolean {
  return resolved === zone || resolved.startsWith(`${zone}/`);
}

/**
 * `"<file>: <specifier>"` for every import crossing an edge the table forbids.
 *
 * @remarks
 * The module list is a parameter rather than {@link sourceModules} closed over,
 * so the checker can be driven with a synthetic module and proved to report as
 * well as to stay silent.
 */
function crossZoneOffenders(modules: readonly Module[]): string[] {
  return modules.flatMap((module) => {
    const zone = Object.keys(FORBIDDEN_ZONE_IMPORTS).find((candidate) =>
      inZone(module.file, candidate),
    );
    const forbidden = zone === undefined ? [] : (FORBIDDEN_ZONE_IMPORTS[zone] ?? []);
    return module.specifiers
      .filter((specifier) => {
        const resolved = resolveWithin(module.file, specifier);
        return (
          resolved !== undefined && forbidden.some((other) => inZone(resolved, other))
        );
      })
      .map((specifier) => `${module.file}: ${specifier}`);
  });
}

/** `"<file>: <specifier>"` for every import of `modules` reaching `pkg`. */
function packageOffenders(modules: readonly Module[], pkg: string): string[] {
  return modules.flatMap((module) =>
    module.specifiers
      .filter((specifier) => importsPackage(specifier, pkg))
      .map((specifier) => `${module.file}: ${specifier}`),
  );
}

describe("src/ imports run one way, app → server → core and app → components → core", () => {
  it("reaches every zone the table names", () => {
    const unscanned = Object.keys(FORBIDDEN_ZONE_IMPORTS).filter(
      (zone) => !sourceModules.some((module) => inZone(module.file, zone)),
    );
    expect(unscanned).toStrictEqual([]);
  });

  it("gives every zone under src/ a row, so a new one needs a decision", () => {
    const zones = readdirSync(path.join(repoRoot, "src"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `src/${entry.name}`)
      .sort();
    expect(zones).toStrictEqual(Object.keys(FORBIDDEN_ZONE_IMPORTS).sort());
  });

  it("keeps exactly one module at the root of src/, which belongs to no zone", () => {
    const atRoot = sourceModules
      .map((module) => module.file)
      .filter((file) => file.split("/").length === 2);
    expect(atRoot).toStrictEqual(["src/proxy.ts"]);
  });

  it.each(Object.entries(FORBIDDEN_ZONE_IMPORTS))(
    "leaves %s importing none of %p",
    (zone) => {
      expect(crossZoneOffenders(modulesIn(zone))).toStrictEqual([]);
    },
  );

  it("reports a crossing when there is one, so the rows above are not vacuous", () => {
    const offenders = crossZoneOffenders([
      {
        file: "src/core/probe.ts",
        specifiers: ["../server/env", "./result", "next"],
      },
    ]);
    expect(offenders).toStrictEqual(["src/core/probe.ts: ../server/env"]);
  });

  // The same control for the spelling the alias made possible. Without the
  // `@/` branch in `resolveWithin` this crossing resolves to nothing, and every
  // row above passes while enforcing nothing against an aliased import.
  it("reports an aliased crossing too, so the @/ spelling is not a way around the table", () => {
    const offenders = crossZoneOffenders([
      {
        file: "src/components/probe.tsx",
        specifiers: [
          "@/server/env",
          "@/core/result",
          "@/components/lib/utils",
          "react",
        ],
      },
    ]);
    expect(offenders).toStrictEqual(["src/components/probe.tsx: @/server/env"]);
  });
});

describe("src/core/ is framework-free", () => {
  // The zone holds the vocabulary the other three are written in. A framework
  // import here makes that vocabulary un-reusable and un-testable without the
  // thing it imported.
  const forbidden = ["next", "react", "react-dom"];

  it.each(forbidden)("imports no %s", (pkg) => {
    expect(packageOffenders(modulesIn("src/core"), pkg)).toStrictEqual([]);
  });
});

describe("src/components/ is UI: no server-only", () => {
  // `server-only` throws on import outside a React Server Components graph, so
  // a component carrying it can never be a Client Component — which is the one
  // thing this zone exists to be able to become.
  it("imports no server-only", () => {
    expect(packageOffenders(modulesIn("src/components"), "server-only")).toStrictEqual(
      [],
    );
  });
});
