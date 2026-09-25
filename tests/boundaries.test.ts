import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import * as z from "zod";

// `eslint.config.mjs` states the edges between the workspace packages under
// `packages/` and those of the apps under `apps/` as `no-restricted-imports`
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
 * comment's closing delimiter behind. No scanned module contains a `//`
 * inside a string literal outside a URL today, and {@link SCANNER_CONTROL} pins the scanner's
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

/**
 * Every file under `directory` whose name matches `extension` — `.ts`/`.tsx`
 * by default — as repo-relative POSIX paths.
 *
 * @remarks
 * `node_modules` is skipped because pnpm gives every workspace package one of
 * its own, and what sits in it is the dependencies' code, not the package's.
 * `fixtures` is skipped because `tests/fixtures/` holds data under test, some
 * of it malformed on purpose, rather than modules of this repository.
 */
function modulesUnder(directory: string, extension = /\.tsx?$/): string[] {
  const absolute = path.join(repoRoot, directory);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.name === "node_modules" || entry.name === "fixtures") {
      return [];
    }
    if (entry.isDirectory()) {
      return modulesUnder(relative, extension);
    }
    return extension.test(entry.name) ? [relative] : [];
  });
}

interface Module {
  /** Repo-relative POSIX path, e.g. `apps/api/src/env.ts`. */
  readonly file: string;
  readonly specifiers: readonly string[];
}

/** Every module of a workspace package, an app or the CDK app, with what it imports. */
const sourceModules: readonly Module[] = [
  ...modulesUnder("packages"),
  ...modulesUnder("apps"),
  ...modulesUnder("infra"),
]
  .sort()
  .map((file) => ({
    file,
    specifiers: importSpecifiers(readFileSync(path.join(repoRoot, file), "utf8")),
  }));

// --- the scanner itself ------------------------------------------------------

// A boundary test whose scanner quietly finds nothing passes forever while
// enforcing nothing, so the scanner is pinned before the edges are asserted
// with it. Every case that could silence it is here: a specifier inside a
// block comment, one inside a line comment, and one inside an ordinary string.
const SCANNER_CONTROL = `
import defaultExport from "hono";
import { named } from "../rules/result";
import "./globals.css";
import type { OnlyAType } from "@radix-ui/react-slot";
export { re } from "./errors";
const lazy = await import("../i18n/messages");
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
 * expectation. Each entry earns its place — a module in each tree, a `.tsx`
 * two directories deep (the recursion and the extension filter), and an app's
 * config file beside its `src/`. What the exhaustive list was really standing
 * in for — a scan that quietly found nothing — is asserted directly by this
 * and by the per-package cases below.
 */
const SCAN_ANCHORS = [
  "apps/api/src/main.ts",
  "apps/web/src/drill/drill-screen.tsx",
  "apps/web/vite.config.ts",
  "infra/src/index.ts",
  "packages/adapters/src/index.ts",
  "packages/domain/src/index.ts",
];

describe("the import scanner the edge assertions run on", () => {
  it("finds every spelling of an import and nothing that only looks like one", () => {
    expect(importSpecifiers(SCANNER_CONTROL)).toStrictEqual([
      "hono",
      "../rules/result",
      "./globals.css",
      "@radix-ui/react-slot",
      "./errors",
      "../i18n/messages",
      "node:fs",
    ]);
  });

  it.each([
    [
      "apps/api/src/main.ts",
      [
        "node:path",
        "@hono/node-server",
        "@instant-composition/adapters",
        "./app",
        "./env",
        "./local-authenticator",
        "./local-table",
        "./log",
      ],
    ],
    [
      "apps/web/src/ui/button.tsx",
      ["@radix-ui/react-slot", "class-variance-authority", "react", "../lib/utils"],
    ],
  ])("reads %s as %p", (file, expected) => {
    const module = sourceModules.find((candidate) => candidate.file === file);
    expect(module?.specifiers).toStrictEqual(expected);
  });

  it("reaches every anchor, so the walk is not stuck in one subdirectory", () => {
    expect(sourceModules.map((module) => module.file)).toEqual(
      expect.arrayContaining(SCAN_ANCHORS),
    );
  });

  // `arrayContaining` above only proves presence: it would still pass if
  // `modulesUnder`'s `/\.tsx?$/` filter were dropped and every `.css` or
  // binary file under a `src/` joined `sourceModules` too. This is the
  // assertion the old exhaustive `toStrictEqual` list stood in for — that the
  // filter actually excludes something — asserted directly instead of by
  // enumerating every file the walk must return.
  it("returns nothing but .ts and .tsx files", () => {
    expect(sourceModules.every((module) => /\.tsx?$/.test(module.file))).toBe(true);
  });
});

/** Whether `resolved` is `tree` itself or a module inside it. */
function inZone(resolved: string, tree: string): boolean {
  return resolved === tree || resolved.startsWith(`${tree}/`);
}

// --- the workspace packages --------------------------------------------------

/**
 * Every workspace package under `packages/`, and the workspace packages it may
 * import.
 *
 * @remarks
 * ADR-0002's `application → domain` and `domain → nothing`, written as a
 * table. `eslint.config.mjs`'s `WORKSPACE_EDGES` states the same edges; the
 * two are checked independently, so an entry deleted there still fails here.
 * A package added under `packages/` has to be given a row before this suite
 * passes, which is the decision the table exists to force.
 *
 * "Nothing" is meant literally: a package imports no npm package and no Node
 * builtin either, until an edit to this table says otherwise.
 */
const WORKSPACE_EDGES: Readonly<Record<string, readonly string[]>> = {
  adapters: ["application", "domain"],
  application: ["domain"],
  contracts: [],
  domain: [],
};

/**
 * The npm packages each workspace package may import, by exact name: ADR-0002's
 * `contracts → (zod only)`, and the AWS SDK plus zod for `adapters`.
 * `eslint.config.mjs`'s `NPM_EDGES` states the same. A package's manifest
 * declares each at the root's own range where the root declares it too, so
 * the workspace resolves one copy of it; one only a package declares has a
 * single range already.
 */
const NPM_EDGES: Readonly<Record<string, readonly string[]>> = {
  adapters: ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb", "zod"],
  application: [],
  contracts: ["zod"],
  domain: [],
};

/**
 * The Node builtins each workspace package may import, by exact specifier:
 * `adapters` reads the catalog snapshot from disk, and no other package does
 * I/O. `eslint.config.mjs`'s `NODE_EDGES` states the same.
 */
const NODE_EDGES: Readonly<Record<string, readonly string[]>> = {
  adapters: ["node:fs/promises"],
  application: [],
  contracts: [],
  domain: [],
};

/** The name every workspace package is published under inside the workspace. */
function packageName(directory: string): string {
  return `@instant-composition/${directory}`;
}

/**
 * `"<file>: <specifier>"` for every import of `modules` that leaves the
 * directory `root` other than by one of the `allowed` specifiers.
 *
 * @remarks
 * A relative specifier is resolved and has to stay inside `root`, or inside
 * one of the `shared` data trees at the repository root. A bare one
 * has to be exactly an allowed name: a subpath such as
 * `@instant-composition/domain/src/day` walks past the package's `exports`,
 * and a path alias such as `@/…` names no package at all.
 * Unlike the ESLint rule, this sees every climb out of the directory, whatever
 * it is spelled as.
 */
function offendersLeaving(
  root: string,
  allowed: ReadonlySet<string>,
  modules: readonly Module[],
  shared: readonly string[] = [],
): string[] {
  return modules.flatMap((module) =>
    module.specifiers
      .filter((specifier) => {
        if (!specifier.startsWith(".")) return !allowed.has(specifier);
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(module.file), specifier),
        );
        return ![root, ...shared].some((tree) => inZone(resolved, tree));
      })
      .map((specifier) => `${module.file}: ${specifier}`),
  );
}

/** {@link offendersLeaving} for package `name`, with the tables' allowed names. */
function workspaceOffenders(name: string, modules: readonly Module[]): string[] {
  return offendersLeaving(
    `packages/${name}`,
    new Set([
      ...(WORKSPACE_EDGES[name] ?? []).map(packageName),
      ...(NPM_EDGES[name] ?? []),
      ...(NODE_EDGES[name] ?? []),
    ]),
    modules,
  );
}

const dependencyMap = z.record(z.string(), z.string()).optional();

const packageManifest = z.object({
  name: z.string(),
  private: z.literal(true),
  scripts: z.record(z.string(), z.string()),
  dependencies: dependencyMap,
  devDependencies: dependencyMap,
  optionalDependencies: dependencyMap,
  peerDependencies: dependencyMap,
});

/** `<tree>/<directory>/package.json`, with every dependency field merged. */
function readManifest(directory: string, tree: "packages" | "apps" | "." = "packages") {
  const manifest = packageManifest.parse(
    JSON.parse(
      readFileSync(path.join(repoRoot, tree, directory, "package.json"), "utf8"),
    ),
  );
  return {
    name: manifest.name,
    scripts: manifest.scripts,
    declared: {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    },
  };
}

/** The root manifest's own range for an npm package, which a package must repeat. */
function rootRange(dependency: string): string | undefined {
  const root = z
    .object({
      dependencies: dependencyMap,
      devDependencies: dependencyMap,
    })
    .parse(JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")));
  return { ...root.devDependencies, ...root.dependencies }[dependency];
}

/**
 * The range a package declares for an npm package the root does not: a caret
 * range on a full version, as `pnpm add` writes one, or `undefined` so the
 * manifest assertion fails on anything else.
 */
function ownRange(
  declared: Readonly<Record<string, string>>,
  dependency: string,
): string | undefined {
  const range = declared[dependency];
  return range !== undefined && /^\^\d+\.\d+\.\d+$/.test(range) ? range : undefined;
}

describe("packages/ imports run one way, adapters → application → domain", () => {
  const directories = readdirSync(path.join(repoRoot, "packages"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it("gives every package under packages/ a row, so a new one needs a decision", () => {
    expect(directories).toStrictEqual(Object.keys(WORKSPACE_EDGES).sort());
    expect(directories).toStrictEqual(Object.keys(NPM_EDGES).sort());
    expect(directories).toStrictEqual(Object.keys(NODE_EDGES).sort());
  });

  it.each(Object.keys(WORKSPACE_EDGES))(
    "scans packages/%s, so the rows below are not asserted over nothing",
    (name) => {
      expect(modulesUnder(`packages/${name}`)).toContain(
        `packages/${name}/src/index.ts`,
      );
    },
  );

  it.each(Object.entries(WORKSPACE_EDGES))(
    "leaves packages/%s importing nothing outside itself but %p",
    (name) => {
      const modules = modulesUnder(`packages/${name}`).map((file) => ({
        file,
        specifiers: importSpecifiers(readFileSync(path.join(repoRoot, file), "utf8")),
      }));
      expect(workspaceOffenders(name, modules)).toStrictEqual([]);
    },
  );

  // A package can import only what its manifest declares — pnpm links nothing
  // else into its node_modules — so the manifest is the third statement of the
  // same edges, and the one an install enforces. It has to say exactly what the
  // table says: a declared dependency the table does not allow is an edge
  // waiting to be used.
  it.each(Object.entries(WORKSPACE_EDGES))(
    "declares in packages/%s/package.json exactly the workspace packages %p and its npm row",
    (name, allowed) => {
      const manifest = readManifest(name);
      expect(manifest.name).toBe(packageName(name));
      expect(manifest.declared).toStrictEqual(
        Object.fromEntries([
          ...allowed.map((dependency) => [packageName(dependency), "workspace:*"]),
          ...(NPM_EDGES[name] ?? []).map((dependency) => [
            dependency,
            rootRange(dependency) ?? ownRange(manifest.declared, dependency),
          ]),
        ]),
      );
    },
  );

  // The root `typecheck` script runs `typecheck` in every package, and pnpm
  // passes over a package that has no such script without a word.
  it.each(Object.keys(WORKSPACE_EDGES))(
    "gives packages/%s a typecheck script for the root typecheck to run",
    (name) => {
      expect(readManifest(name).scripts["typecheck"]).toBe("tsc -p tsconfig.json");
    },
  );

  it("reports every way out of a package, so the rows above are not vacuous", () => {
    const offenders = workspaceOffenders("domain", [
      {
        file: "packages/domain/src/rules/probe.ts",
        specifiers: [
          "./sibling",
          "../index",
          "../../../application/src/index",
          "../../../../scripts/lib/json.mjs",
          "@/rules/result",
          "@instant-composition/application",
          "zod",
          "node:path",
        ],
      },
    ]);
    expect(offenders).toStrictEqual([
      "packages/domain/src/rules/probe.ts: ../../../application/src/index",
      "packages/domain/src/rules/probe.ts: ../../../../scripts/lib/json.mjs",
      "packages/domain/src/rules/probe.ts: @/rules/result",
      "packages/domain/src/rules/probe.ts: @instant-composition/application",
      "packages/domain/src/rules/probe.ts: zod",
      "packages/domain/src/rules/probe.ts: node:path",
    ]);
  });

  it("admits an allowed npm package by its exact name and no subpath of it", () => {
    const offenders = workspaceOffenders("contracts", [
      {
        file: "packages/contracts/src/probe.ts",
        specifiers: [
          "zod",
          "zod/v4/core",
          "zod-openapi",
          "@instant-composition/application",
          "node:fs",
        ],
      },
    ]);
    expect(offenders).toStrictEqual([
      "packages/contracts/src/probe.ts: zod/v4/core",
      "packages/contracts/src/probe.ts: zod-openapi",
      "packages/contracts/src/probe.ts: @instant-composition/application",
      "packages/contracts/src/probe.ts: node:fs",
    ]);
  });

  it("admits an allowed Node builtin by its exact specifier and no other builtin", () => {
    const offenders = workspaceOffenders("adapters", [
      {
        file: "packages/adapters/src/probe.ts",
        specifiers: [
          "node:fs/promises",
          "@aws-sdk/client-dynamodb",
          "node:fs",
          "node:child_process",
          "@aws-sdk/client-s3",
          "@instant-composition/contracts",
        ],
      },
    ]);
    expect(offenders).toStrictEqual([
      "packages/adapters/src/probe.ts: node:fs",
      "packages/adapters/src/probe.ts: node:child_process",
      "packages/adapters/src/probe.ts: @aws-sdk/client-s3",
      "packages/adapters/src/probe.ts: @instant-composition/contracts",
    ]);
  });

  it("admits an allowed package by its name and by nothing else", () => {
    const offenders = workspaceOffenders("application", [
      {
        file: "packages/application/src/probe.ts",
        specifiers: [
          "@instant-composition/domain",
          "@instant-composition/domain/src/day",
          "../../domain/src/index",
        ],
      },
    ]);
    expect(offenders).toStrictEqual([
      "packages/application/src/probe.ts: @instant-composition/domain/src/day",
      "packages/application/src/probe.ts: ../../domain/src/index",
    ]);
  });
});

// --- the deployable apps ------------------------------------------------------

/**
 * Every app under `apps/` that holds source, and the workspace packages it may
 * import: ADR-0002's `apps/* → application, adapters, contracts`, plus
 * `domain`. `web` imports none: it reaches the API over HTTP. `eslint.config.mjs`'s
 * `APP_WORKSPACE_EDGES` states the same.
 */
const APP_WORKSPACE_EDGES: Readonly<Record<string, readonly string[]>> = {
  api: ["adapters", "application", "contracts", "domain"],
  web: [],
};

/**
 * The npm specifiers each app's `src/` may import, by exact name
 * (`APP_NPM_EDGES`). A subpath is listed as itself, and the manifest declares
 * the package it belongs to.
 */
const APP_NPM_EDGES: Readonly<Record<string, readonly string[]>> = {
  api: ["@hono/node-server", "hono"],
  web: [
    "@fontsource-variable/inter-tight",
    "@fontsource-variable/jetbrains-mono",
    "@fontsource-variable/space-grotesk",
    "@radix-ui/react-slot",
    "@tanstack/react-query",
    "@tanstack/react-router",
    "class-variance-authority",
    "clsx",
    "react",
    "react-dom/client",
    "tailwind-merge",
    "use-intl",
  ],
};

/** The Node builtins each app may import, by exact specifier (`APP_NODE_EDGES`). */
const APP_NODE_EDGES: Readonly<Record<string, readonly string[]>> = {
  api: ["node:path"],
  web: [],
};

/**
 * The build tools each app declares as devDependencies (`APP_TOOLING_EDGES`):
 * its config files beside `src/` may import them, and `src/` may not.
 */
const APP_TOOLING_EDGES: Readonly<Record<string, readonly string[]>> = {
  api: [],
  web: [
    "@hey-api/openapi-ts",
    "@tailwindcss/vite",
    "@types/react",
    "@types/react-dom",
    "@vitejs/plugin-react",
    "tailwindcss",
    "vite",
  ],
};

/**
 * Directories at the repository root an app's source may read by a relative
 * path: data, not modules of another package. The web client renders the one
 * message catalog under `messages/`.
 */
const APP_SHARED_TREES: Readonly<Record<string, readonly string[]>> = {
  api: [],
  web: ["messages"],
};

/** The package a specifier belongs to: `react-dom/client` is `react-dom`'s. */
function packageOf(specifier: string): string {
  const segments = specifier.split("/");
  return (specifier.startsWith("@") ? segments.slice(0, 2) : segments.slice(0, 1)).join(
    "/",
  );
}

/**
 * The range an app declares for a build tool: the root's own where the root
 * declares it, else a caret or tilde range on a full version, or `undefined`
 * so the manifest assertion fails on anything else.
 */
function toolRange(
  declared: Readonly<Record<string, string>>,
  dependency: string,
): string | undefined {
  const range = declared[dependency];
  return (
    rootRange(dependency) ??
    (range !== undefined && /^[\^~]\d+\.\d+\.\d+$/.test(range) ? range : undefined)
  );
}

describe("apps/ imports only the packages ADR-0002 allows", () => {
  const directories = readdirSync(path.join(repoRoot, "apps"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it("gives every app under apps/ a row, so a new one needs a decision", () => {
    const apps = Object.keys(APP_WORKSPACE_EDGES).sort();
    expect(directories).toStrictEqual(apps);
    for (const table of [
      APP_NPM_EDGES,
      APP_NODE_EDGES,
      APP_TOOLING_EDGES,
      APP_SHARED_TREES,
    ]) {
      expect(Object.keys(table).sort()).toStrictEqual(apps);
    }
  });

  it.each(Object.entries(APP_WORKSPACE_EDGES))(
    "leaves apps/%s importing nothing outside itself but %p and its npm and Node rows",
    (name, workspace) => {
      const files = modulesUnder(`apps/${name}`);
      expect(files).toContain(`apps/${name}/src/index.ts`);
      const modules = files.map((file) => ({
        file,
        specifiers: importSpecifiers(readFileSync(path.join(repoRoot, file), "utf8")),
      }));
      const allowed = new Set([
        ...workspace.map(packageName),
        ...(APP_NPM_EDGES[name] ?? []),
        ...(APP_NODE_EDGES[name] ?? []),
      ]);
      const shared = APP_SHARED_TREES[name] ?? [];
      const source = modules.filter((module) =>
        inZone(module.file, `apps/${name}/src`),
      );
      const config = modules.filter((module) => !source.includes(module));
      expect(offendersLeaving(`apps/${name}`, allowed, source, shared)).toStrictEqual(
        [],
      );
      expect(
        offendersLeaving(
          `apps/${name}`,
          new Set([...allowed, ...(APP_TOOLING_EDGES[name] ?? [])]),
          config,
          shared,
        ),
      ).toStrictEqual([]);
    },
  );

  it.each(Object.entries(APP_WORKSPACE_EDGES))(
    "declares in apps/%s/package.json exactly the workspace packages %p, its npm row and its tools",
    (name, workspace) => {
      const manifest = readManifest(name, "apps");
      expect(manifest.name).toBe(packageName(name));
      expect(manifest.declared).toStrictEqual(
        Object.fromEntries([
          ...workspace.map((dependency) => [packageName(dependency), "workspace:*"]),
          ...(APP_NPM_EDGES[name] ?? [])
            .map(packageOf)
            .map((dependency) => [
              dependency,
              rootRange(dependency) ?? ownRange(manifest.declared, dependency),
            ]),
          ...(APP_TOOLING_EDGES[name] ?? []).map((dependency) => [
            dependency,
            toolRange(manifest.declared, dependency),
          ]),
        ]),
      );
      expect(manifest.scripts["typecheck"]).toBe("tsc -p tsconfig.json");
    },
  );

  it("admits a relative read of a shared root tree, and of no other", () => {
    const probe = {
      file: "apps/web/src/i18n/probe.ts",
      specifiers: [
        "../../../../messages/ja.json",
        "../../../../content/taxonomy.json",
        "../../../../scripts/lib/json.mjs",
      ],
    };
    expect(
      offendersLeaving("apps/web", new Set(), [probe], ["messages"]),
    ).toStrictEqual([
      "apps/web/src/i18n/probe.ts: ../../../../content/taxonomy.json",
      "apps/web/src/i18n/probe.ts: ../../../../scripts/lib/json.mjs",
    ]);
  });

  it("reports a climb out of an app and a package it may not name", () => {
    const allowed = new Set(["@instant-composition/application", "hono"]);
    expect(
      offendersLeaving("apps/api", allowed, [
        {
          file: "apps/api/src/probe.ts",
          specifiers: [
            "./app",
            "hono",
            "hono/aws-lambda",
            "../../../scripts/lib/json.mjs",
            "../../web/src/main",
            "@/ui/button",
            "zod",
          ],
        },
      ]),
    ).toStrictEqual([
      "apps/api/src/probe.ts: hono/aws-lambda",
      "apps/api/src/probe.ts: ../../../scripts/lib/json.mjs",
      "apps/api/src/probe.ts: ../../web/src/main",
      "apps/api/src/probe.ts: @/ui/button",
      "apps/api/src/probe.ts: zod",
    ]);
  });
});

// --- the CDK app ---------------------------------------------------------------

/**
 * The npm specifiers the CDK app under `infra/` may import, by exact name
 * (`INFRA_NPM_EDGES`): the CDK library and the construct base class. It names
 * no workspace package and no Node builtin — it describes the AWS resources,
 * not the application that runs on them.
 */
const INFRA_NPM_EDGES: readonly string[] = ["aws-cdk-lib", "constructs"];

/** The CDK CLI, which `cdk.json`'s app command is run by and nothing imports. */
const INFRA_TOOLING_EDGES: readonly string[] = ["aws-cdk"];

describe("infra/ imports the CDK and nothing of the application", () => {
  it("leaves infra/ importing nothing outside itself but its npm row", () => {
    const files = modulesUnder("infra");
    expect(files).toContain("infra/src/index.ts");
    const modules = files.map((file) => ({
      file,
      specifiers: importSpecifiers(readFileSync(path.join(repoRoot, file), "utf8")),
    }));
    expect(offendersLeaving("infra", new Set(INFRA_NPM_EDGES), modules)).toStrictEqual(
      [],
    );
  });

  it("declares in infra/package.json exactly its npm row and the CDK CLI", () => {
    const manifest = readManifest("infra", ".");
    expect(manifest.name).toBe(packageName("infra"));
    expect(manifest.declared).toStrictEqual(
      Object.fromEntries(
        [...INFRA_NPM_EDGES, ...INFRA_TOOLING_EDGES].map((dependency) => [
          dependency,
          toolRange(manifest.declared, dependency),
        ]),
      ),
    );
    expect(manifest.scripts["typecheck"]).toBe("tsc -p tsconfig.json");
  });

  it("reports a workspace package, a Node builtin and an unlisted subpath", () => {
    expect(
      offendersLeaving("infra", new Set(INFRA_NPM_EDGES), [
        {
          file: "infra/src/probe.ts",
          specifiers: [
            "./stage",
            "aws-cdk-lib",
            "aws-cdk-lib/aws-s3",
            "@instant-composition/domain",
            "node:fs",
            "../../packages/domain/src/index",
          ],
        },
      ]),
    ).toStrictEqual([
      "infra/src/probe.ts: aws-cdk-lib/aws-s3",
      "infra/src/probe.ts: @instant-composition/domain",
      "infra/src/probe.ts: node:fs",
      "infra/src/probe.ts: ../../packages/domain/src/index",
    ]);
  });
});

// --- reaching a package from outside it ---------------------------------------

/**
 * `"<file>: <specifier>"` for every relative import of `modules` that resolves
 * into `packages/`, `apps/` or `infra/`.
 *
 * @remarks
 * A package or an app publishes only what its `exports` names, and a relative
 * path walks straight past that into any module it holds. From outside one the
 * one way in is its name, `@instant-composition/<dir>`.
 */
function relativeReachesIntoPackages(modules: readonly Module[]): string[] {
  return modules.flatMap((module) =>
    module.specifiers
      .filter((specifier) => {
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(module.file), specifier),
        );
        return (
          specifier.startsWith(".") &&
          ["packages", "apps", "infra"].some((tree) => inZone(resolved, tree))
        );
      })
      .map((specifier) => `${module.file}: ${specifier}`),
  );
}

describe("a workspace package or app is reached from outside only by its name", () => {
  const trees: readonly (readonly [string, RegExp])[] = [
    ["tests", /\.tsx?$/],
    ["scripts", /\.mjs$/],
  ];

  it.each(trees)(
    "finds no relative import into packages/, apps/ or infra/ under %s/",
    (tree, extension) => {
      const files = modulesUnder(tree, extension);
      expect(files).not.toStrictEqual([]);
      const modules = files.map((file) => ({
        file,
        specifiers: importSpecifiers(readFileSync(path.join(repoRoot, file), "utf8")),
      }));
      expect(relativeReachesIntoPackages(modules)).toStrictEqual([]);
    },
  );

  it("reports a relative reach into a package, and nothing else, so the check is not vacuous", () => {
    const offenders = relativeReachesIntoPackages([
      {
        file: "tests/probe.test.ts",
        specifiers: [
          "../packages/domain/src/day",
          "./../packages/application",
          "../apps/api/src/app",
          "../infra/src/app",
          "@instant-composition/domain",
          "./repo-tree",
          "../scripts/lib/json.mjs",
        ],
      },
      {
        file: "scripts/cards/probe.mjs",
        specifiers: ["../../packages/domain/src/index", "../lib/json.mjs"],
      },
    ]);
    expect(offenders).toStrictEqual([
      "tests/probe.test.ts: ../packages/domain/src/day",
      "tests/probe.test.ts: ./../packages/application",
      "tests/probe.test.ts: ../apps/api/src/app",
      "tests/probe.test.ts: ../infra/src/app",
      "scripts/cards/probe.mjs: ../../packages/domain/src/index",
    ]);
  });
});
