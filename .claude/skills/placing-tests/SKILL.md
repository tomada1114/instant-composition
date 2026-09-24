---
name: placing-tests
description: >
  Decides where a new test file goes — always under tests/, never beside the module it
  covers — which of vitest.config.ts's five projects it joins (unit, component under
  jsdom for a .test.tsx, the explicit automation list, smoke for the suite that serves a
  build, or dynamodb for the one needing DynamoDB local), and which coverage.thresholds
  floor governs it. Use when adding a .test.ts or .test.tsx file, when a test needs a
  DOM, spawns a subprocess or a server, needs DynamoDB, when choosing between `pnpm exec
  vitest run` and `pnpm test:coverage`, or when a coverage run drops below a floor.
---

# Placing Tests

**Owns:** where a new test file goes, which vitest project it joins, and the coverage
floors that govern it. **Does not own:** how the test itself is written, its assertion
style, and its fixtures (`writing-tests`); compile-time assertions with `expectTypeOf`
(`type-testing`); what a gate file may contain at all (`changing-gates`).

## Location: `tests/`, never beside the source

Every test file lives at `tests/<subject>.test.ts` or `tests/<subject>.test.tsx`, named
after the seam it covers rather than after a file path — `tests/home-screen.test.tsx`
for the start screen, `tests/proxy.test.ts` for the locale proxy, `tests/result.test.ts`
for the `Result` vocabulary. Never co-locate a test next to the module it covers.

This is settled, and it is deliberately against the App Router convention of keeping a
test beside its component. Four mechanical reasons, each of which would have to be
undone to move a test into `src/`:

- `coverage.include` in `vitest.config.ts` is the `.ts` and `.tsx` files under `src/`,
  under each `packages/*/src/` and each `apps/*/src/`, and `scripts/**/*.mjs`. A test
  file in any of those source trees would count itself as covered source and quietly
  lift every floor it sits under — the one direction a coverage number must never move
  by accident.
- The three vitest projects select on `tests/**` globs plus the file extension, and the
  automation project is an explicit list of `tests/…` paths. A co-located test joins no
  project until every one of those globs is widened.
- `eslint.config.mjs` scopes rules by tree: the `tests/vitest-rules` and
  `tests/relaxations` blocks match `tests/**`, while `src/size-budget`'s 200-line cap
  and the Next.js rule set match `src/**`. A test under `src/` would get the source
  rules and none of the test ones.
- `next build` compiles the `src/` tree. A test file there is build input.

`tests/fixtures/` is reserved for data under test, not test modules. Nothing under it is
linted, formatted, type-checked, spell-checked, or collected as a test —
`eslint.config.mjs`, `.prettierignore`, `tsconfig.json`, `typos.toml` and
`vitest.config.ts` all skip it, and `tests/tooling-ignores.test.ts` holds the five
together. That is what makes the tree usable for a fixture that is _meant_ to be
malformed or to fail, or for a whole project belonging to another toolchain, driven from
an `automation` test as a child process.

## Choosing a project

`vitest.config.ts` splits `test.projects` five ways. Placement follows from what the
file actually touches and which environment it needs — never from its name or its
subject:

- **`unit`** — `tests/**/*.test.ts`, the default. The test imports only `src/**` (plus,
  as a deliberate exception, the pure-function modules under `scripts/lib/`) and touches
  no filesystem, subprocess, or git. Node environment, 5-second budget.
- **`component`** — `tests/**/*.test.tsx`, selected by the extension alone. This is the
  only project running under jsdom, and the only one loading `tests/dom-setup.ts`, which
  registers the DOM matchers and Testing Library's `cleanup`. A test that renders a
  component under jsdom goes here by being written as `.tsx`; there is no list to join.
  The screens' Client Components are tested here — `tests/home-screen.test.tsx`,
  `tests/drill-session.test.tsx` — with `fetch` stubbed and the router mocked, so they
  have no I/O either and keep the same short budget as `unit`.
- **`automation`** — the explicit `automationTests` list at the top of
  `vitest.config.ts`, with a 120-second budget. Everything that shells out, reads or
  writes a temp directory, spawns `git`/`node`, or walks whole trees on disk asserting
  against files rather than against imported code.
- **`smoke`** — the `smokeTests` list beside it, one file today. A test joins it only
  when it cannot run without `pnpm build`'s output on disk: it starts the built
  application with `next start` and asserts over `fetch`. That is what makes it a
  project of its own rather than another automation entry — the default run
  (`pnpm test`, `pnpm test:coverage`, and ci.yml's `test` job) leaves it out by naming
  only `unit`, `component` and `automation`, because there is no build there to serve
  and a suite that built one for itself would pay for a second build in every workflow.
  `pnpm run test:smoke` is what runs it, from `check:source` and from ci.yml's `static`
  job, both times straight after `Build`. A test here checks the build it was handed
  rather than making one: `tests/server-smoke.test.ts` fails with an instruction when
  `.next/BUILD_ID` is missing, and again when it is older than `src/`, `messages/`,
  `next.config.ts` or `postcss.config.mjs`, because a run against last commit's build
  passes every assertion while proving nothing about the change. Adding a file here is a
  claim that no in-process test could have asserted the same thing; prefer `automation`
  whenever one could.
- **`dynamodb`** — the `dynamodbTests` list: the learner-store contract suite against
  the DynamoDB adapter on DynamoDB local, and the API driven over that adapter, each
  case on a table it creates. It is left out of the default run for the same reason as
  `smoke` — `pnpm test` and `check:quick` must not need a container — and
  `pnpm run test:dynamodb` runs it, after `pnpm db:up` on a checkout and from
  `check:source` and ci.yml's `static` job, whose service container runs the image
  `compose.yaml` pins. It fails with an instruction when nothing answers rather than
  skipping. Coverage does not come from here: the default run never includes it, so what
  it exercises is covered in-process too — the adapter's side of the wire against a fake
  DynamoDB on a loopback port, in `automation`, and the API over the in-memory store, in
  `unit`.

The default scripts name the projects they run instead of negating the two they leave
out, because two `--project='!name'` filters do not narrow each other: vitest runs a
project any one filter matches, so `!smoke` alone lets `dynamodb` back in.
`tests/ci-sync.test.ts` fails when a project in `vitest.config.ts` is named by none of
`check:source`'s test steps, so a new project cannot fall out of every run unnoticed.

The two directions fail differently, which is why `automation` is a list rather than a
glob. Forgetting to register a test that does I/O leaves it in `unit`, where the short
budget makes it time out loudly rather than pass on a budget nobody chose. Listing a
pure test in `automationTests` is the quiet mistake: it still passes, just on a budget
far longer than it needs. So a new test starts in `unit` (or in `component`, by its
extension) and joins `automationTests` only when its I/O is deliberately reviewed.

**Why the timeouts differ:** a `unit` or `component` test has no I/O, so if it hangs the
only possible cause is an infinite loop or an unresolved promise, and a short timeout
surfaces that in seconds. An `automation` test legitimately needs the long budget for a
real subprocess or temp-directory operation — giving it the short one would make correct
tests flaky.

Coverage is collected once for the whole run, never per project, so the split above
changes nothing about which floor applies.

## Coverage floors

`coverage.include` lists source and automation files on purpose: a file with no test
still counts toward the denominator at 0% instead of vanishing from it. A new file is
covered from the moment it exists — write its test in the same PR, not as follow-up.

**There is no top-level floor, and that is a decision rather than an omission.** The v8
provider checks a top-level threshold against the coverage of _all_ included files
combined, so one number over `src/` and `scripts/` together would let a well-tested zone
subsidize an untested file in the other. Independent per-glob threshold sets are what
stop that: each is judged only against its own coverage, and each answers a different
question.

- **The `src/` zones** named in `coverage.thresholds` carry the baseline floor for this
  repository's own logic. That glob is deliberately narrower than `coverage.include`:
  `src/app/**` and the `.tsx` files under `src/components/**` carry **no floor at all**.
  They are framework entry points and rendered markup, exercised by a component render
  or a build rather than by a unit test, and a floor they cannot meet would only teach
  the next author to move the number. They stay inside `coverage.include`, so an
  untested file there still reports as a percentage — it simply has no floor to trip.
  That distinction is the whole point: a narrower _threshold_ glob keeps the number
  visible, while a `coverage.exclude` entry would hide it, which is what AGENTS.md's
  "never weaken a gate" forbids by name. Widening or narrowing the threshold glob is a
  decision to argue for in a PR.
- **`src/components/**/*.ts`** splits the zone by extension. Its `.ts` files are plain
  logic — a hook, a formatter, a client for a JSON endpoint, `cn` — with no rendering
  step to hide behind, so they carry the same baseline floor as the `src/` zones above.
  A module earns the markup exemption only by being a `.tsx` component; moving logic out
  of `src/server/` into a component module is not a way out of a floor.
- **`packages/*/src/**`** carries the same baseline floor as the `src/` zones. The
  workspace packages are where those zones are moving, so the floor was set when the
  packages were still empty rather than left to arrive after code did. A package's tests
  live under `tests/` like every other test, and import the package by its name.
- **`apps/*/src/**`** carries the same floor, for the same reason, from an app's first
  file. An app's local entry point (`apps/api/src/main.ts`) runs only in a process a
  test would have to spawn, so it counts at 0% against that floor: keep it to wiring,
  and put anything with a branch in a module a test imports.
- **`scripts/**`** was never measured before it was added to `coverage.include`, so its
  floor is the last measured coverage rounded down to a clean value, not a guessed
  target — it has been raised as coverage grew (see the dated comments in
  `vitest.config.ts`). Raise it again as real coverage grows; never invent a number
  ahead of the measurement.
- **`scripts/lib/guard/**`** — the credential and path detection rule engine, the most
  security-critical code in the repository — carries its own higher floor, so it cannot
  regress just because it is dragged along by whatever number the broader `scripts/**`
  tree happens to sit at. It counts toward that aggregate too, on top of its own floor.
  The two trees' branch floors are set independently and are raised as each tree's own
  measured branch coverage grows, so do not assume one bounds the other.

See `vitest.config.ts`'s `coverage.thresholds` for the current numbers; this skill
deliberately does not repeat them, since a copied number goes stale the moment the
config changes.

**Coverage stops at the process boundary.** The v8 provider instruments the Vitest
workers and nothing else, so a `src/` module that only ever executes inside a process
the test spawns reports 0% however thoroughly the integration test exercises it — and 0%
against a floor fails the run. Design for it rather than discovering it: keep the part
that runs in the child thin and put the logic behind it in a module the test can also
call in-process.

- **Branch coverage is the one that matters.** Cover both sides of a conditional rather
  than adding a trivial test whose only effect is moving a line/statement percentage.
- **A floor is never lowered, and no file is added to `coverage.exclude` to move a
  number** — AGENTS.md's "Security and human approval" holds that prohibition for every
  agent, including one whose task is only "make CI green." What this skill owns is which
  floor applies and why.

## Commands

```bash
pnpm exec vitest run tests/<name>.test.ts   # one file, fast iteration
pnpm test:coverage                          # full suite with floors enforced
pnpm build && pnpm run test:smoke           # the smoke project, which needs the build
pnpm db:up && pnpm run test:dynamodb        # the dynamodb project, which needs DynamoDB local
```

If `pnpm test:coverage` fails on a floor, add real coverage for the uncovered branch —
do not adjust the threshold or the include list.
