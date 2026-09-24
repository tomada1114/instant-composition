import { defineConfig } from "vitest/config";

// Without this, a fixture suite written to fail is collected as one of this
// repository's own tests.
const fixtures = "tests/fixtures/**";

// Tests that import repository automation, touch the filesystem, spawn a
// subprocess, or use git. They are listed explicitly so a new test defaults to
// the short-timeout unit project until its I/O needs are deliberately reviewed.
// The files not listed here are pure unit tests; guard-rules.test.ts,
// pr-checks.test.ts, cards-schema.test.ts and ts-resolve.test.ts are the
// intentional exceptions to the usual rule that a unit test drives a package
// or an app, because each drives pure-function modules under scripts/
// directly and touches nothing else.
//
// The two boundary suites — boundaries and placeholders — are listed for the same reason workflows.test.ts is: they
// assert against files on disk rather than against imported code, walking
// whole trees to do it. They are fast today, but their cost scales with the
// repository rather than with what they import, which is exactly the case
// the short unit budget is not meant to cover.
const automationTests = [
  "tests/adapters-catalog.test.ts",
  "tests/adapters-dynamodb-store.test.ts",
  "tests/api-local-run.test.ts",
  "tests/boundaries.test.ts",
  "tests/cards-cli.test.ts",
  "tests/cards-lifecycle.test.ts",
  "tests/catalog-build.test.ts",
  "tests/check-staged.test.ts",
  "tests/ci-sync.test.ts",
  "tests/clean.test.ts",
  "tests/contracts-openapi.test.ts",
  "tests/dev.test.ts",
  "tests/env-example.test.ts",
  "tests/git-env.test.ts",
  "tests/labels.test.ts",
  "tests/lefthook-partial-stage.test.ts",
  "tests/messages.test.ts",
  "tests/node-tools.test.ts",
  "tests/placeholders.test.ts",
  "tests/repo-tree.test.ts",
  "tests/skills-frontmatter.test.ts",
  "tests/sync-agents.test.ts",
  "tests/sync-labels.test.ts",
  "tests/tooling-ignores.test.ts",
  "tests/verify-hooks.test.ts",
  "tests/web-openapi-client.test.ts",
  "tests/workflows.test.ts",
];

// The one suite that needs the whole stack on disk before it can run at all:
// it serves `pnpm web:build`'s bundle with `vite preview` in front of the API,
// started as `pnpm api` starts it, on DynamoDB local, and asserts over HTTP.
// That is why it is its own project rather than another entry in
// `automationTests` — the default run (`pnpm test`, `pnpm test:coverage`, and
// ci.yml's `test` job) has neither the bundle nor the container, and a suite
// that quietly built the bundle for itself would pay for a second build in
// every workflow. It refuses to run against a missing or stale bundle, or
// without DynamoDB local, instead, so the build stays the caller's to do
// exactly once. `pnpm run test:smoke` is what runs it, from `check:source` and
// from ci.yml's `static` job immediately after `Build the web client`; the
// default scripts leave it out by naming the projects they run. Naming the
// file here is still what keeps it out of `unit` below, whose glob would
// otherwise collect it on a 5-second budget.
const smokeTests = ["tests/stack-smoke.test.ts"];

// The suites that need DynamoDB local running beside them: the store contract
// against the DynamoDB adapter, and the API over it, on tables they create and
// delete. Kept out of
// the default run the way `smoke` is, because `pnpm test` and `check:quick`
// must not depend on a container, and a suite that quietly skipped without
// one would pass while proving nothing. `pnpm run test:dynamodb` is what runs
// it, after `pnpm db:up` on a checkout and from ci.yml's `static` job against
// its service container; it fails with an instruction when nothing answers.
// The adapter's own logic is covered in-process by the `unit` suite against a
// fake HTTP handler, so the coverage floors do not depend on this project.
const dynamodbTests = [
  "tests/adapters-dynamodb-local.test.ts",
  "tests/api-dynamodb-local.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    // Cleanup is the runner's job, not each test's. A spy, a stubbed env var or
    // a stubbed global that outlives the test that created it turns a later
    // failure into a mystery whose cause is in a different file, and makes the
    // "each test passes when run alone" rule in AGENTS.md unenforceable.
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    // A focused test silently shrinks the suite to one case. Failing on it
    // everywhere — not only under CI, which is the default — means the author
    // finds it before the commit rather than the pipeline finding it after.
    allowOnly: false,
    // Five projects, split by what a test actually touches rather than by
    // where it lives: a new `.test.ts` file is unit by default, a `.test.tsx`
    // file needs a DOM and joins `component` instead, the explicit automation
    // list receives the long budget only after its I/O needs are known,
    // `smoke` is the one suite that cannot run without a build to serve and
    // DynamoDB local behind it, and `dynamodb` the one that needs DynamoDB
    // local alone. A
    // hung unit or component test (no I/O, so it can only be looping or
    // awaiting forever) is a bug that should be visible in seconds.
    // `coverage` below is unaffected by this split — Vitest collects and
    // thresholds coverage once for the whole run, never per project.
    //
    // `extends: true` is what carries `allowOnly: false` and the
    // restore/clear/unstub settings above into every project below; a
    // hand-written project object without it would silently drop them.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: [...automationTests, ...smokeTests, ...dynamodbTests, fixtures],
          testTimeout: 5_000,
          hookTimeout: 5_000,
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          // A React component needs `document`/`window` to render, so this
          // project alone runs under jsdom; `tests/**/*.test.ts` stays on the
          // faster `node` environment inherited from the top level.
          environment: "jsdom",
          include: ["tests/**/*.test.tsx"],
          exclude: [fixtures],
          setupFiles: ["./tests/dom-setup.ts"],
          // No I/O here either: rendering a component and querying the
          // result is the same budget as a unit test.
          testTimeout: 5_000,
          hookTimeout: 5_000,
        },
      },
      {
        extends: true,
        test: {
          name: "automation",
          include: automationTests,
          // Repository automation tests shell out to git/node in temp
          // directories, which is slower than a unit test but must not be
          // allowed to hang CI.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: "smoke",
          include: smokeTests,
          // Spawning two servers, waiting for them to listen, and asking them
          // for a document and a round is the same order of cost as the
          // automation project's subprocesses, so it gets the same budget
          // rather than one nobody measured.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: "dynamodb",
          include: dynamodbTests,
          // Each case creates a table and makes a handful of round trips to a
          // local container: slower than a unit test, far from a subprocess.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "lcov"],
      // Report every source and automation file, so an untested module shows
      // up as 0% instead of vanishing from the denominator.
      include: [
        "packages/*/src/**/*.ts",
        "packages/*/src/**/*.tsx",
        "apps/*/src/**/*.ts",
        "apps/*/src/**/*.tsx",
        "scripts/**/*.mjs",
      ],
      // No top-level lines/functions/statements/branches here: Vitest's v8
      // provider checks those against the coverage of *all* included files
      // combined (apps, packages and scripts together), which would let a
      // well-tested package subsidize an untested scripts/ file or vice versa.
      // Each glob below is its own independent threshold set instead, so the
      // packages, the apps, scripts/**, and scripts/lib/guard/** are each
      // judged only against their own coverage.
      thresholds: {
        // The workspace packages hold this repository's own logic — the
        // rules, the commands and queries, the contract and the adapters —
        // so each file under them counts against this floor from the day it
        // exists.
        "packages/*/src/**": {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80,
        },
        // The deployable apps sit on top of the packages and hold the same kind
        // of logic — an HTTP adapter's routing, validation and logging, and a
        // client's state, requests and rendering — so they carry the same
        // floor from their first file. A local entry that only a spawned
        // process runs (`apps/api/src/main.ts`, `apps/web/src/main.tsx`)
        // counts here at whatever the in-process tests reach, which is why it
        // is kept thin; `tests/stack-smoke.test.ts` runs both, but coverage
        // stops at the process boundary.
        "apps/*/src/**": {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80,
        },
        // scripts/lib/guard/** is the credential/path-detection rule engine —
        // the most security-critical code in the repository — so it carries a
        // higher floor than the rest of scripts/**. Measured baseline at the
        // time this floor was set: 90.9% statements, 82.35% branches, 100%
        // functions, 90% lines. Each value below is that measurement rounded
        // down to the nearest multiple of 5.
        "scripts/lib/guard/**": {
          lines: 90,
          functions: 100,
          statements: 90,
          branches: 80,
        },
        // Last raised by issue #98 against a measured baseline of 88.52%
        // statements, 80.05% branches, 93.79% functions and 88.48% lines,
        // each rounded down to the nearest multiple of 5 — the convention
        // every raise here has used (#44, #88, #98). Three of the scripts
        // that baseline was measured over have since left the tree with the
        // packaging gates (issue #4); the floor is deliberately left where it
        // was rather than re-fitted to whatever the smaller tree now scores.
        // It exists so a new automation script can't ship with zero tests and
        // nothing reporting the number moving; scripts/lib/guard/** also
        // counts toward this aggregate, on top of its own stricter floor
        // above.
        "scripts/**": {
          lines: 85,
          functions: 90,
          statements: 85,
          branches: 80,
        },
      },
    },
  },
});
