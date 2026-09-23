import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * The `enum` ban, applied to every file this config sees.
 *
 * @remarks
 * `tsconfig.json` used to carry this as `erasableSyntaxOnly`, which existed
 * because `src/` had to run under Node's type stripping unbuilt. Next.js
 * compiles the tree instead, so the premise is gone and the ban is stated
 * here, where it can name the reason rather than a whole syntax class.
 */
const NO_ENUM = {
  selector: "TSEnumDeclaration",
  message:
    "`enum` emits a runtime object no other TypeScript construct needs. Use a union of string literals, or an `as const` object.",
};

/**
 * The `export *` ban, shared by the whole `src/` tree and by the extra
 * entry-point rules below.
 *
 * @remarks
 * `no-restricted-syntax` options replace rather than merge across config
 * objects, so every narrower block that sets this rule has to restate the
 * entries it still wants — otherwise it silently switches them back on.
 */
const NO_EXPORT_STAR = {
  selector: "ExportAllDeclaration",
  message:
    "`export *` publishes symbols implicitly. Re-export each public symbol by name.",
};

/**
 * The hand-written application source: the Next.js tree and every workspace
 * package's `src/`. The syntax bans, the named-export surface and the size
 * budget below hold for both, so moving a module out of `src/` into a package
 * is not a way out of any of them.
 */
const SOURCE_FILES = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
];

/** What `src/internal/**` is, in the words of the rule that made it private. */
const INTERNAL_IS_PRIVATE =
  "src/internal/ is private. Tests reach it through the public surface of the module that owns it (see the `writing-tests` skill), and repository automation must not depend on module internals at all.";

/**
 * Each zone under `src/`, as every specifier that can reach into it.
 *
 * @remarks
 * A zone is reachable two ways. Relatively, leaving your own zone costs at
 * least one `../`, and the same module is `../core/result` from one file and
 * `../../core/result` from another. The globstar after the `../` absorbs the rest
 * whatever the importer's depth, so one pattern covers every caller; the bare
 * form is listed alongside the recursive one because a directory import
 * (`../server`) has no trailing segment for a trailing globstar to match.
 *
 * The leading `../` is load-bearing, not decoration. An unanchored
 * `**\/server` also matches the package subpath `next-intl/server`, which
 * `src/i18n/request.ts` imports — the anchored form cannot, because a bare
 * specifier never starts with `..` or `.`.
 *
 * Each entry also carries a `./../**` twin of every `../**` pattern, because
 * `no-restricted-imports` matches the specifier text through the `ignore`
 * package rather than resolving it, and `ignore` treats a leading `./` as a
 * different string from a leading `../` — so `./../server/env` does not
 * match the `../**\/server/**` pattern without its own `./../**` copy. A bare specifier still cannot start with
 * `./..`, so the twin is exactly as safe as the pattern it doubles.
 *
 * The other way is the `@/*` → `./src/*` alias `tsconfig.json` declares,
 * because shadcn/ui writes `@/components/...` imports into every component it
 * copies in. That spelling carries no `../` to anchor and needs none: it is
 * already absolute from `src/`, so `@/server/**` names the zone from any depth,
 * and it is safe to match unanchored because no bare package name can start
 * with `@/` — a scoped package is `@scope/name`, and an empty scope is not
 * legal. A zone left without its `@/` twin would be a boundary the alias walks
 * straight through, which is why {@link zonePatterns} generates every entry
 * with both, rather than leaving the twin to be remembered per zone.
 *
 * @param {string} name
 * @returns {string[]}
 */
function zonePatterns(name) {
  return [
    `../**/${name}`,
    `../**/${name}/**`,
    `./../**/${name}`,
    `./../**/${name}/**`,
    `@/${name}`,
    `@/${name}/**`,
  ];
}

const ZONE = /** @type {Record<"app" | "server" | "i18n" | "components", string[]>} */ (
  Object.fromEntries(
    ["app", "server", "i18n", "components"].map((name) => [name, zonePatterns(name)]),
  )
);

/**
 * Each workspace package under `packages/`, and the workspace packages it may
 * import. ADR-0002's `application → domain` and `domain → nothing`, as a
 * table the `boundaries/packages/*` blocks below are generated from.
 *
 * @remarks
 * `tests/boundaries.test.ts` holds the same table and checks it against the
 * module graph and each package's manifest, so an entry deleted here still
 * fails the suite.
 */
const WORKSPACE_EDGES = /** @type {const} */ ({
  domain: [],
  application: ["domain"],
});

/**
 * The `no-restricted-imports` block for one workspace package.
 *
 * @remarks
 * A package reaches another only by its name, `@instant-composition/<dir>`,
 * because that is the spelling its manifest's `dependencies` gate — pnpm links
 * nothing a package does not declare. So the rule has two halves. The first
 * refuses every bare specifier except an allowed package's name: an npm
 * package, a `node:` builtin, the `@/` alias of the Next.js tree and a
 * workspace package outside the row alike. It is a `regex` rather than a
 * `group` because a gitignore-style group cannot say "anything but these". The
 * second refuses a relative path into another package's directory or into a
 * `src/` tree, which is what a climb out of the package into the Next.js
 * application looks like. It matches specifier text, not the resolved path, so
 * it does not see every climb out of the package; `tests/boundaries.test.ts`
 * resolves each one and does.
 *
 * @param {keyof typeof WORKSPACE_EDGES} name
 * @param {string} message
 */
function workspacePackageBoundary(name, message) {
  const allowed = WORKSPACE_EDGES[name].map(
    (dependency) => `@instant-composition/${dependency}`,
  );
  const others = Object.keys(WORKSPACE_EDGES).filter((other) => other !== name);
  return {
    name: `boundaries/packages/${name}`,
    files: [`packages/${name}/**/*.ts`, `packages/${name}/**/*.tsx`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `^(?!\\.\\.?(?:/|$)${allowed.map((pkg) => `|${pkg}$`).join("")})`,
              message,
            },
            {
              group: [...others, "src"].flatMap((tree) =>
                zonePatterns(tree).filter((pattern) => pattern.startsWith(".")),
              ),
              message,
            },
          ],
        },
      ],
    },
  };
}

/** Why `src/components/` looks only at `src/core/`, `src/i18n/` and the framework. */
const COMPONENTS_LOOK_ONLY_DOWNWARD =
  "src/components/ is UI: it renders what it is handed. The import order is app → components → core, so a component names no page and no handler. Take the value as a prop and let src/app/ do the fetching.";

export default defineConfig([
  // Only generated trees are ignored; everything hand-written is linted,
  // including repository automation and config files. `.claude/skills/` is a
  // generated mirror of `.agents/skills/` (`pnpm agents:sync`), where the real
  // files are linted at their real path — linting the copy too would report
  // the same violation twice, at a path nobody may edit.
  // `.claude/worktrees/` holds full working copies created by agent sessions,
  // linted in their own checkout.
  // A `tests/fixtures/` file is malformed on purpose, so linting it reports
  // the very defect a test asserts on.
  // `.next/` and `next-env.d.ts` are written by `next dev`/`next build`.
  globalIgnores([
    "dist/",
    ".next/",
    "next-env.d.ts",
    "coverage/",
    ".claude/skills/",
    ".claude/worktrees/",
    "tests/fixtures/",
  ]),
  {
    linterOptions: {
      // A disable directive that no longer suppresses anything is dead weight
      // that hides the next real violation.
      reportUnusedDisableDirectives: "error",
    },
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          // `@ts-ignore` hides an error forever; `@ts-expect-error` fails once
          // the underlying problem is gone, so it is the only allowed escape
          // hatch and it must say why.
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
        },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "no-console": "error",
      "no-restricted-syntax": ["error", NO_ENUM],
    },
  },
  // `eslint-config-next` states its two rule blocks against `**/*`, which here
  // would also mean `scripts/**/*.mjs` and `tests/**/*.ts` — trees this
  // repository parses with typescript-eslint and lints with its own rules.
  // Narrow them to the tree the Next.js compiler owns. The config's third
  // entry has no `files` key (it is a global-ignores entry) and is taken as
  // published.
  ...next.map((entry) =>
    "files" in entry ? { ...entry, files: ["src/**/*.{ts,tsx}"] } : entry,
  ),
  {
    name: "next/pinned-react-version",
    files: ["src/**/*.{ts,tsx}"],
    settings: {
      // `eslint-config-next` asks eslint-plugin-react to *detect* the React
      // version, and that detection path calls an ESLint 9 context API that
      // ESLint 10 removed — every react/* rule throws while loading. Naming
      // the version skips detection entirely. Keep this in step with the
      // `react` major/minor in package.json, and drop it once
      // eslint-plugin-react declares eslint 10 in its peer range.
      react: { version: "19.2" },
    },
  },
  {
    name: "src/shared-syntax",
    files: SOURCE_FILES,
    rules: {
      "no-restricted-syntax": ["error", NO_ENUM, NO_EXPORT_STAR],

      // A `switch` over a union is the one place where adding a member to that
      // union silently changes behavior instead of failing to compile. With
      // `considerDefaultExhaustiveForUnions`, a `default` branch is accepted as
      // the deliberate answer, so this asks for a decision rather than for a
      // case per member.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    name: "public-api/explicit-surface",
    files: SOURCE_FILES,
    // Next.js finds a page, layout, loading/error boundary or route handler by
    // its file name and reads it through its default export, so `src/app/**`
    // is the one tree where a default export is the interface rather than an
    // unnamed hole in one. The other two entries are the same case one
    // directory over: Next.js loads `src/proxy.ts` by that exact path, and
    // `createNextIntlPlugin` in next.config.ts loads `src/i18n/request.ts` by
    // that exact path, both reading a default export — so the name is the
    // file's and the export cannot carry one. All three are framework-owned
    // entry points, named one by one; everywhere else under `src/` the surface
    // stays named exports, which is what a reviewer can read a diff of.
    ignores: ["src/app/**", "src/i18n/request.ts", "src/proxy.ts"],
    rules: {
      "no-restricted-exports": [
        "error",
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
    },
  },
  {
    name: "src/size-budget",
    files: SOURCE_FILES,
    rules: {
      // Blank lines and comments count, deliberately: the budget is on how
      // much a reader has to hold at once, and a file is not easier to follow
      // because two thirds of it is prose. 200 is a ceiling, not a target —
      // every module under `src/` is well under it today, so the rule fires
      // only on a file that grew past the point where it does one thing.
      // Splitting is the answer; raising the number or writing a disable
      // directive is what AGENTS.md's "never weaken a gate" rules out.
      //
      // `tests/**` and `scripts/**` are deliberately outside this: a table-
      // driven suite and a repository automation entry point are both long by
      // nature, and capping them would buy nothing but split files.
      "max-lines": ["error", { max: 200, skipBlankLines: false, skipComments: false }],
    },
  },
  // --- zone boundaries -------------------------------------------------------
  //
  // AGENTS.md states one import order — `app` → `server` → `core`, with
  // `app` → `components` → `core` beside it and `i18n` a leaf the page tree,
  // the components and the handlers read — and the five blocks below are that
  // order, written per zone as the zones each one may not name. The leaf
  // property is an edge like any other: `src/i18n/` may read `src/core/` and
  // nothing above it.
  // `tests/boundaries.test.ts` asserts the same shape from the module graph, so
  // deleting a block here still fails the suite.
  //
  // `no-restricted-imports` options replace rather than merge across config
  // objects, exactly like `no-restricted-syntax` (see NO_EXPORT_STAR above).
  // The blocks match disjoint file sets on purpose, so none of them can silently
  // drop another's patterns — which is why `src/app` and `src/server` are stated
  // apart. Keep a new block disjoint from them too.
  {
    name: "boundaries/core-is-framework-free-and-imports-no-zone",
    files: ["src/core/**/*.ts", "src/core/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "next",
                "next/**",
                "react",
                "react/**",
                "react-dom",
                "react-dom/**",
              ],
              message:
                "src/core/ holds the vocabulary the other zones are written in — a Result, a domain type, a pure function — and it stays free of the framework so it survives a change of it. Put the framework-aware code in src/app/ or src/server/.",
            },
            {
              group: [...ZONE.server, ...ZONE.app, ...ZONE.i18n, ...ZONE.components],
              message:
                "src/core/ is the bottom of the import order app → server → core (and app → components → core), so it names no zone above it. A type only one zone needs belongs in that zone; one they share belongs here, with nothing imported to define it.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "boundaries/i18n-is-a-leaf",
    files: ["src/i18n/**/*.ts", "src/i18n/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...ZONE.app, ...ZONE.server, ...ZONE.components],
              message:
                "src/i18n/ is a leaf: the page tree, the components and the handlers read it, and it reads nothing but src/core/ and its own catalogs. An import here inverts that and makes the locale list depend on the code that renders it.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "boundaries/server-never-imports-app",
    files: ["src/server/**/*.ts", "src/server/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...ZONE.app, ...ZONE.components],
              message:
                "src/server/ sits below src/app/ in the import order app → server → core. A handler naming a page, a layout, a route module or a component inverts that: the App Router tree imports the server layer and renders the components, never the other way round.",
            },
          ],
        },
      ],
    },
  },
  {
    // The zone shadcn/ui copies components into, and the app's own components
    // beside them. It sits between `src/app/` and `src/core/` — a component is
    // handed its data and renders it — so it may name the framework, the UI
    // libraries, `src/core/` and the `src/i18n/` leaf, and nothing else under
    // `src/`. `server-only` is banned outright rather than reached through a
    // zone pattern: a component importing it has decided it can never be a
    // Client Component, which is the opposite of what this zone is for, and
    // the marker's whole job is to fail the build far from the cause.
    name: "boundaries/components-import-only-core-and-i18n",
    files: ["src/components/**/*.ts", "src/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...ZONE.app, ...ZONE.server],
              message: COMPONENTS_LOOK_ONLY_DOWNWARD,
            },
            {
              group: ["server-only"],
              message:
                "server-only pins a module to the server graph, and a component under src/components/ has to stay renderable from either graph. Put the server-side work in src/server/ and hand the component its result.",
            },
          ],
        },
      ],
    },
  },
  // --- workspace package boundaries ----------------------------------------
  //
  // The same discipline one level up, between the packages ADR-0002 lays out.
  // Each block matches only its own package's files, so they stay disjoint
  // from the `src/` zone blocks above and from each other.
  workspacePackageBoundary(
    "domain",
    "packages/domain holds the pure rules and imports nothing outside itself: no workspace package, no npm package, no Node builtin, nothing from the Next.js tree. Time, time zones and randomness arrive as arguments; I/O belongs in packages/application's ports.",
  ),
  workspacePackageBoundary(
    "application",
    "packages/application imports @instant-composition/domain and nothing else outside itself. Reach another package by its name once ADR-0002 allows the edge and this package's manifest declares it; never by a relative path into its directory.",
  ),
  {
    name: "automation/node-scripts",
    files: ["scripts/**/*.mjs", ".agents/skills/**/*.mjs"],
    rules: {
      // These files are the CLI surface of repository automation.
      "no-console": "off",

      // Automation must run on plain Node before `pnpm install`, so it is
      // authored as `.mjs` and declares its boundary types in JSDoc, which
      // `checkJs` enforces just as strictly. This rule only recognises
      // TypeScript annotations, so leaving it on would demand syntax that is
      // not valid JavaScript.
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
  {
    // The `writing-tests` skill states these rules in prose; this is what enforces the
    // ones a linter can see. The recommended set is taken as published and the
    // escalations below are the entries this repository will not run on
    // "warn", starting with the two that quietly shrink the suite.
    ...vitest.configs.recommended,
    name: "tests/vitest-rules",
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      ...vitest.configs.recommended.rules,

      // "No it.skip/it.todo left on main" and "a focused test never lands".
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",

      // An assertion outside a test reports nothing when it fails, and a test
      // with no assertion passes whatever the code does. `expectTypeOf` is
      // listed because a case whose whole assertion is type-level — see the
      // `type-testing` skill — has no runtime `expect` and is not meant to;
      // without it here, `expect-expect` would report such a case as
      // assertion-less.
      "vitest/no-standalone-expect": "error",
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "expectTypeOf"] },
      ],
      "vitest/valid-expect": "error",

      // One spelling, so a search for a test finds every one of them.
      "vitest/consistent-test-it": ["error", { fn: "it" }],

      // `vitest/require-top-level-describe` is deliberately left off. Several
      // suites here own a fixture for the whole file — a temp git repository,
      // a packed tarball — and set it up in a file-level `beforeAll`, which
      // this rule forbids. Satisfying it would mean wrapping five whole files
      // in an extra describe for no gain in what the tests assert.
      //
      // `vitest/no-conditional-expect` comes from the recommended set and is
      // turned off for the same kind of reason: AGENTS.md prescribes
      // asserting on a caught error inside `catch`, and the workflow suite
      // branches on what the repository actually contains before asserting
      // against it.
      "vitest/no-conditional-expect": "off",
    },
  },
  {
    name: "tests/relaxations",
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      // Tests deliberately construct invalid input to prove it is rejected.
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    name: "boundaries/private-trees-are-not-importable",
    files: ["tests/**/*.ts", "tests/**/*.tsx", "scripts/**/*.mjs"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // `dist/internal` used to be listed beside this: the same module
              // after a build, back when this repository published a tarball.
              // Nothing builds to `dist/` any more (issue #4 removed the
              // packaging gates), so the built spelling is gone and the source
              // one is the whole rule.
              // The `@/` spellings are the same module through the alias
              // `tsconfig.json` declares, which no `**/src/...` pattern sees.
              group: [
                "**/src/internal",
                "**/src/internal/**",
                "@/internal",
                "@/internal/**",
              ],
              message: INTERNAL_IS_PRIVATE,
            },
          ],
        },
      ],
    },
  },
  // Must stay last: turns off stylistic rules that would fight Prettier.
  eslintConfigPrettier,
]);
