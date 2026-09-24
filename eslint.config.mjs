import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * The `enum` ban, applied to every file this config sees.
 *
 * @remarks
 * Stated here rather than as `tsconfig.json`'s `erasableSyntaxOnly`, where it
 * can name the reason rather than a whole syntax class. `pnpm api` runs the
 * API's source on Node's type stripping, which rejects an `enum` too;
 * `tests/api-local-run.test.ts` is what catches the rest of what Node cannot
 * strip.
 */
const NO_ENUM = {
  selector: "TSEnumDeclaration",
  message:
    "`enum` emits a runtime object no other TypeScript construct needs. Use a union of string literals, or an `as const` object.",
};

/**
 * The `export *` ban, shared by every package's and app's `src/` and by the
 * extra entry-point rules below.
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
 * The hand-written application source: every workspace package's `src/` and
 * every deployable app's `src/`. The syntax bans, the named-export surface and
 * the size budget below hold for both, so moving a module from a package into
 * an app, or back, is not a way out of any of them.
 */
const SOURCE_FILES = [
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
  "apps/*/src/**/*.ts",
  "apps/*/src/**/*.tsx",
];

/** What a `src/internal/**` directory is, in the words of the rule that made it private. */
const INTERNAL_IS_PRIVATE =
  "A src/internal/ directory is private. Tests reach it through the public surface of the package or app that owns it (see the `writing-tests` skill), and repository automation must not depend on module internals at all.";

/**
 * Every relative specifier that can reach into a directory named `name`.
 *
 * @remarks
 * Leaving your own directory costs at least one `../`, and the same module is
 * `../domain/src/index` from one file and `../../domain/src/index` from
 * another. The globstar after the `../` absorbs the rest whatever the
 * importer's depth, so one pattern covers every caller; the bare form is listed
 * alongside the recursive one because a directory import (`../domain`) has no
 * trailing segment for a trailing globstar to match.
 *
 * The leading `../` is load-bearing, not decoration: an unanchored
 * `**\/server` would also match a package subpath such as `react-dom/server`,
 * and the anchored form cannot, because a bare specifier never starts with
 * `..` or `.`.
 *
 * Each entry also carries a `./../**` twin of every `../**` pattern, because
 * `no-restricted-imports` matches the specifier text through the `ignore`
 * package rather than resolving it, and `ignore` treats a leading `./` as a
 * different string from a leading `../`. A bare specifier still cannot start
 * with `./..`, so the twin is exactly as safe as the pattern it doubles.
 *
 * @param {string} name
 * @returns {string[]}
 */
function zonePatterns(name) {
  return [`../**/${name}`, `../**/${name}/**`, `./../**/${name}`, `./../**/${name}/**`];
}

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
  contracts: [],
  adapters: ["application", "domain"],
});

/**
 * The npm packages each workspace package may import, by exact name: ADR-0002's
 * `contracts → (zod only)`, and the AWS SDK plus zod for `adapters`, the one
 * package that performs I/O. Every other package imports none.
 *
 * @remarks
 * `tests/boundaries.test.ts` holds the same table, and checks that the
 * package's manifest declares exactly these, at the root's own version where
 * the root declares one too.
 */
const NPM_EDGES =
  /** @type {Record<keyof typeof WORKSPACE_EDGES, readonly string[]>} */ ({
    domain: [],
    application: [],
    contracts: ["zod"],
    adapters: ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb", "zod"],
  });

/**
 * The Node builtins each workspace package may import, by exact specifier.
 * Only `adapters` does I/O, and it reads the catalog snapshot from disk.
 *
 * @remarks
 * `tests/boundaries.test.ts` holds the same table.
 */
const NODE_EDGES =
  /** @type {Record<keyof typeof WORKSPACE_EDGES, readonly string[]>} */ ({
    domain: [],
    application: [],
    contracts: [],
    adapters: ["node:fs/promises"],
  });

/**
 * A relative path into `packages/` or `apps/`, from any tree outside them.
 *
 * @remarks
 * A package or an app publishes only what its `exports` names; a relative
 * path walks past that into any module it holds. Every block below that sets
 * `no-restricted-imports` for `tests/` or `scripts/` restates this
 * entry, because the rule's options replace rather than merge across config
 * objects. `tests/boundaries.test.ts` resolves each relative specifier and
 * checks the same thing without relying on how it is spelled.
 */
const NO_RELATIVE_PACKAGE_IMPORT = {
  group: [
    "../**/packages/**",
    "./../**/packages/**",
    "../**/apps/**",
    "./../**/apps/**",
  ],
  message:
    "Reach a workspace package or app by its name, @instant-composition/<dir>, which goes through its `exports`. A relative path into packages/ or apps/ walks past its public surface into modules it keeps private.",
};

/**
 * Each deployable app under `apps/` that holds source, and the workspace
 * packages it may import: ADR-0002's `apps/* → application, adapters,
 * contracts`, plus `domain` for the `Result` vocabulary and the tuning the
 * API reads. `apps/web` imports none: it reaches the API over HTTP, through
 * types generated from the contract's OpenAPI document (ADR-0008).
 *
 * @remarks
 * `tests/boundaries.test.ts` holds the same tables.
 */
const APP_WORKSPACE_EDGES = /** @type {const} */ ({
  api: ["adapters", "application", "contracts", "domain"],
  web: [],
});

/**
 * The npm specifiers and Node builtins each app's `src/` may import, by exact
 * name. A subpath is listed as itself (`react-dom/client`), because the row
 * admits specifiers, not packages.
 */
const APP_NPM_EDGES =
  /** @type {Record<keyof typeof APP_WORKSPACE_EDGES, readonly string[]>} */ ({
    api: ["hono", "@hono/node-server"],
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
  });

const APP_NODE_EDGES =
  /** @type {Record<keyof typeof APP_WORKSPACE_EDGES, readonly string[]>} */ ({
    api: ["node:path"],
    web: [],
  });

/**
 * The build tools each app declares as devDependencies: its own config files
 * (`apps/<dir>/*.ts`, outside `src/`) may import them on top of its `src/`
 * row, and `src/` itself may not.
 */
const APP_TOOLING_EDGES =
  /** @type {Record<keyof typeof APP_WORKSPACE_EDGES, readonly string[]>} */ ({
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
  });

/**
 * The `no-restricted-imports` block for one workspace package or app.
 *
 * @remarks
 * A package reaches another only by its name, `@instant-composition/<dir>`,
 * because that is the spelling its manifest's `dependencies` gate — pnpm links
 * nothing a package does not declare. So the rule has two halves. The first
 * refuses every bare specifier except an allowed package's name: an npm
 * package, a `node:` builtin, a path alias and a workspace package outside the
 * row alike. It is a `regex` rather than a `group` because a gitignore-style
 * group cannot say "anything but these". The second refuses a relative path
 * into another package's or app's directory or into another `src/` tree. It
 * matches specifier text, not the resolved path, so it does not see every
 * climb out of the package; `tests/boundaries.test.ts` resolves each one and
 * does.
 *
 * @param {{ tree: "packages" | "apps", name: string, workspace: readonly string[], npm: readonly string[], node: readonly string[], files?: readonly string[], block?: string }} row
 * @param {string} message
 */
function workspaceBoundary(row, message) {
  const allowed = [
    ...row.workspace.map((dependency) => `@instant-composition/${dependency}`),
    ...row.npm,
    ...row.node,
  ];
  const others = [
    ...Object.keys(WORKSPACE_EDGES),
    ...Object.keys(APP_WORKSPACE_EDGES),
  ].filter((other) => other !== row.name);
  return {
    name: `boundaries/${row.tree}/${row.block ?? row.name}`,
    files: [
      ...(row.files ?? [
        `${row.tree}/${row.name}/**/*.ts`,
        `${row.tree}/${row.name}/**/*.tsx`,
      ]),
    ],
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

/**
 * @param {keyof typeof WORKSPACE_EDGES} name
 * @param {string} message
 */
function workspacePackageBoundary(name, message) {
  return workspaceBoundary(
    {
      tree: "packages",
      name,
      workspace: WORKSPACE_EDGES[name],
      npm: NPM_EDGES[name],
      node: NODE_EDGES[name],
    },
    message,
  );
}

/**
 * One app's boundary, as two disjoint blocks when the app has config files
 * of its own: `src/` held to its row, and the config files beside it to the
 * row plus its build tools. `no-restricted-imports` options replace rather
 * than merge, so the two cannot share a block.
 *
 * @param {keyof typeof APP_WORKSPACE_EDGES} name
 * @param {string} message
 */
function appBoundary(name, message) {
  const row = /** @type {const} */ ({
    tree: "apps",
    name,
    workspace: APP_WORKSPACE_EDGES[name],
    npm: APP_NPM_EDGES[name],
    node: APP_NODE_EDGES[name],
  });
  const tooling = APP_TOOLING_EDGES[name];
  if (tooling.length === 0) return [workspaceBoundary(row, message)];
  return [
    workspaceBoundary(
      { ...row, files: [`apps/${name}/src/**/*.ts`, `apps/${name}/src/**/*.tsx`] },
      message,
    ),
    workspaceBoundary(
      {
        ...row,
        npm: [...row.npm, ...tooling],
        files: [`apps/${name}/*.ts`],
        block: `${name}/config`,
      },
      message,
    ),
  ];
}

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
  // `apps/web/src/openapi/` is generated from `packages/contracts/openapi.json`
  // by `pnpm web:client`, and `tests/web-openapi-client.test.ts` fails on any
  // difference from what the generator writes, so a hand edit there cannot
  // survive; it is still type-checked, as everything `src/` imports is.
  globalIgnores([
    "apps/web/dist/",
    "apps/web/src/openapi/",
    "dist/",
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
  {
    // The web client's React rules: the hooks rules — the React Compiler's
    // diagnostics included — from the declared `eslint-plugin-react-hooks`,
    // taken as its flat `recommended` config publishes them.
    ...reactHooks.configs.flat.recommended,
    name: "web/react",
    files: ["apps/web/**/*.{ts,tsx}"],
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
    // No framework here loads a module by its file name, so every surface is
    // named exports, which is what a reviewer can read a diff of. An app's
    // config file beside its `src/` (`apps/web/vite.config.ts`) is outside
    // this block: Vite reads it through its default export.
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
      // every module under a `src/` is well under it today, so the rule fires
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
  // --- workspace package boundaries ----------------------------------------
  //
  // The import order between the packages and apps ADR-0002 lays out. Each
  // block matches only its own package's files, so they stay disjoint from
  // each other: `no-restricted-imports` options replace rather than merge
  // across config objects, exactly like `no-restricted-syntax` (see
  // NO_EXPORT_STAR above), so two blocks matching one file would silently
  // drop one's patterns. `tests/boundaries.test.ts` asserts the same edges from
  // the module graph, so deleting a block here still fails the suite.
  workspacePackageBoundary(
    "domain",
    "packages/domain holds the pure rules and imports nothing outside itself: no workspace package, no npm package, no Node builtin. Time, time zones and randomness arrive as arguments; I/O belongs in packages/application's ports.",
  ),
  workspacePackageBoundary(
    "contracts",
    "packages/contracts holds the HTTP API's zod schemas and the OpenAPI document built from them, and imports zod and nothing else outside itself: no workspace package, no Node builtin, no zod subpath. A test that holds a schema to an application type imports both packages from tests/.",
  ),
  workspacePackageBoundary(
    "application",
    "packages/application imports @instant-composition/domain and nothing else outside itself. Reach another package by its name once ADR-0002 allows the edge and this package's manifest declares it; never by a relative path into its directory.",
  ),
  workspacePackageBoundary(
    "adapters",
    "packages/adapters implements packages/application's ports: it imports @instant-composition/application and @instant-composition/domain, the AWS SDK's DynamoDB client and document client, zod, and node:fs/promises, each by its exact name, and nothing else outside itself.",
  ),
  ...appBoundary(
    "api",
    "apps/api is the HTTP adapter: it imports @instant-composition/adapters, application, contracts and domain, hono, @hono/node-server and node:path, each by its exact name, and nothing else outside itself — never a package by a relative path.",
  ),
  ...appBoundary(
    "web",
    "apps/web is the browser client: its src/ imports React, the router, the query cache, use-intl and the UI libraries its row names, each by its exact name, and no workspace package — it reaches the API over HTTP through the types generated into src/openapi/. Its config files add Vite and its plugins. Never a package by a relative path.",
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
            NO_RELATIVE_PACKAGE_IMPORT,
            {
              // `dist/internal` used to be listed beside this: the same module
              // after a build, back when this repository published a tarball.
              // Nothing builds to `dist/` any more (issue #4 removed the
              // packaging gates), so the built spelling is gone and the source
              // one is the whole rule.
              group: ["**/src/internal", "**/src/internal/**"],
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
