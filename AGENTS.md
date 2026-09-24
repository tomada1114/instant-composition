# Project Guide

This file is the source of truth for every agent working in this repository.
Tool-specific files (`CLAUDE.md` and anything like it) add only what is specific to that
tool; they never restate what is here.

Machine-enforceable rules are not written down here either. `eslint.config.mjs`,
`tsconfig.json`, `.prettierrc.json`, `vitest.config.ts` and `pnpm-workspace.yaml` are
the source of truth for those, and running the gate is how you learn them.

Neither are the conventions of a particular kind of work. Those live in the skills under
`.agents/skills/`, one per kind of change, and load when the work you are doing calls
for them — see [Skills](#skills) for the index. What is left in this file is what has to
be true _before_ you know which task you are on: what this package is, how to check a
change, and which decisions need a human.

**Never hand-edit `.claude/skills/`** — it is a generated mirror, and a change there is
lost at the next sync. `authoring-skills` owns how a skill is authored, mirrored, and
checked.

## Overview

Instant Composition is a Japanese→English instant-composition drill for Japanese
learners of English: a card shows a Japanese sentence and the learner says it in English
before the timer runs out, then checks the answer. Cards are pre-generated JSON under
`content/`, written ahead of time by Claude Code skills, so the application calls no
language model at runtime. It is a pnpm workspace in ESM-only TypeScript: a React
single-page app under `apps/web` (Vite, Tailwind v4, components derived from shadcn/ui)
calls an HTTP API under `apps/api` (Hono), which keeps progress in DynamoDB through the
packages under `packages/` — DynamoDB local, in a container, on a checkout. It was
started from a template whose language-model layer was removed whole.

It is private: nothing here is packed, published, or consumed as a tarball, so there is
no published `engines.node` floor — `.node-version` and `devEngines.runtime` carry the
Node 24 development runtime instead. pnpm 11 is the package manager, used through
Corepack.

## Before the first screen

The design direction is settled: an "instrument" — near-black canvas, white and grey
ink, big figures and small tracked mono labels, one lime for the four roles
`designing-ui` names — and it is dark only. `designing-ui` holds the lock, the ledger
behind it and the component recipes; read it before building or restyling any screen. A
screen adapts to the lock rather than renegotiating it: never choose a palette, a
typeface or a layout by taste to get a screen done, and never add a light theme.

## Before changing the architecture

The architecture follows the target recorded in `docs/architecture/` — start at its
`README.md`, whose ADRs say what is decided and what is only proposed. Domain and
application code lives in `packages/` and takes the shape `designing-application-core`
describes. A change to a context boundary, a persistence shape, an external contract, a
provider, or the security model owes an ADR, as `recording-architecture-decisions` sets
out.

## Quick reference

```sh
pnpm dev           # DynamoDB local, the API and the web client together, on http://127.0.0.1:5173
pnpm check:quick   # format check, lint, typecheck, tests — the everyday gate
pnpm check:source  # the same gate plus the web build, the smoke and DynamoDB suites, and coverage
pnpm fix           # ESLint autofix, then Prettier
pnpm test          # tests only
pnpm test:coverage # tests with the coverage thresholds enforced
pnpm test:smoke    # serves the last `pnpm web:build` in front of the API and asserts over HTTP
pnpm test:dynamodb # the store contract suite and the API against DynamoDB local; needs `pnpm db:up`
pnpm db:up         # start DynamoDB local from compose.yaml's pinned image, on localhost:8000
pnpm db:down       # stop and remove it; it runs in memory, so its tables go with it
pnpm api           # serve apps/api on http://127.0.0.1:8787/api against DynamoDB local
pnpm web           # serve apps/web on http://127.0.0.1:5173, proxying /api to `pnpm api`
pnpm web:build     # build apps/web's static SPA into apps/web/dist/
pnpm web:client    # rewrite apps/web/src/openapi/ from packages/contracts/openapi.json
pnpm agents:sync   # regenerate .claude/skills/ from .agents/skills/
pnpm agents:check  # fail when the two skill trees have drifted apart
pnpm repo:labels   # create/update GitHub labels from .github/labels.yml
pnpm hooks:install # repair the Git hooks; `pnpm install` installs them already
pnpm clean         # remove the build and tool caches (apps/web/dist, coverage, .eslintcache, tsbuildinfo)
pnpm clean:deep    # the same, plus dist/ and node_modules/ — a reinstall follows
pnpm cards:lint    # validate content/'s lists and every card; exit 1 on any ERROR
pnpm cards:gaps    # plan a generation run: which cells get how many cards
pnpm cards:add     # admit new cards from a JSON file (ids, lint, near-duplicate check)
pnpm cards:update  # merge edited fields into existing cards
pnpm cards:tombstone # delete a card into content/tombstones.jsonl; its id is never reused
pnpm cards:stamp   # mark reviewed cards so the app shows them
pnpm cards:queue   # list cards waiting for review, most urgent first
pnpm cards:show    # print cards or tombstones (--brief, --json)
pnpm cards:dupes   # near-duplicate candidates within a subtopic and against tombstones
pnpm cards:stats   # totals, review status, coverage by cell, grammar usage
pnpm cards:new-id  # print fresh card ids
pnpm catalog:build # write content/'s snapshot per language pair to dist/catalog/<target>/<l1>.json
pnpm contracts:openapi # rewrite packages/contracts/openapi.json from the schemas
```

Reach for `pnpm clean`/`pnpm clean:deep` rather than an `rm -rf`: `scripts/clean.mjs`
refuses any path that resolves outside this repository, symlinks followed, so neither a
typo nor a directory link leading out of the checkout can reach the machine, and the
target list is reviewable in `package.json` instead of retyped at a prompt each time.
`clean:deep` leaves the checkout without dependencies — run `pnpm install` after it.

Run a single test file with `pnpm exec vitest run tests/<name>.test.ts`.

`pnpm dev` is the whole local stack in one command: it runs `pnpm db:up`, builds the
catalog snapshot when `dist/catalog/` has none, and runs `pnpm api` and `pnpm web` side
by side until Ctrl-C, which stops both. DynamoDB local keeps running, with its tables,
until `pnpm db:down`.

`pnpm check:quick` is the everyday local gate, and needs nothing running beside it;
`pnpm check:source` adds the web build, the smoke suite, the DynamoDB suite and the
coverage floors on top of it, so it needs Docker and `pnpm db:up` first. CI runs those
same checks as separate steps, so a green `pnpm check:source` here means those are green
too. `lefthook`'s pre-commit hook runs a staged-file-scoped version of the same tools —
format applied rather than merely checked, tests limited to the ones reachable from the
staged files — before every commit. Nothing — not a hook, not a workflow — defines a
check of its own; they all call these scripts.

Development and source checks stay on Node 24, stated once in `.node-version` and once
in `devEngines.runtime`. Never relax `devEngines.runtime`'s `onFail: error`, and never
reach for `--config.runtime-on-fail=ignore`: nothing here runs on any other Node.

## Validating a change

Run the narrowest check that can fail, then the gate. Reaching for `pnpm check:source`
on every edit is slow enough that it stops being run at all.

| What you changed                                     | The narrowest check that can fail                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| A module under `packages/domain/` or `application/`  | `pnpm exec vitest run tests/<package>-*.test.ts`                       |
| A module under `packages/adapters/`                  | `pnpm exec vitest run tests/adapters-*.test.ts`                        |
| The DynamoDB store, or the store contract suite      | `pnpm db:up`, then `pnpm test:dynamodb`                                |
| A schema or route under `packages/contracts/`        | `pnpm exec vitest run tests/contracts-*.test.ts`                       |
| `packages/contracts/openapi.json`                    | `pnpm web:client`, then `pnpm typecheck`                               |
| A module under `apps/api/`                           | `pnpm exec vitest run tests/api-*.test.ts`                             |
| `apps/api/src/env.ts` or `.env.example`              | `pnpm exec vitest run tests/api-env.test.ts tests/env-example.test.ts` |
| A module or screen under `apps/web/src/`             | `pnpm exec vitest run tests/web-<name>`                                |
| A catalog under `messages/`, or `apps/web/src/i18n/` | `pnpm exec vitest run tests/messages.test.ts`                          |
| `apps/web/vite.config.ts`, `index.html` or its CSS   | `pnpm web:build`, then `pnpm test:smoke`                               |
| Anything only the running stack shows                | `pnpm db:up && pnpm web:build`, then `pnpm test:smoke`                 |
| An import that crosses a package or app boundary     | `pnpm exec vitest run tests/boundaries.test.ts`                        |
| A package's or app's manifest or `tsconfig.json`     | `pnpm typecheck`, then `tests/boundaries.test.ts`                      |
| A test                                               | `pnpm exec vitest run tests/<name>.test.ts`                            |
| A script under `scripts/`                            | `pnpm exec vitest run tests/<script>.test.ts`                          |
| A script under `scripts/cards/`                      | `pnpm exec vitest run tests/cards-*.test.ts`                           |
| Anything under `content/`                            | `pnpm cards:lint`                                                      |
| A skill under `.agents/skills/`                      | `pnpm agents:sync && pnpm agents:check && pnpm test`                   |
| `package.json`, `pnpm-workspace.yaml`                | `pnpm install`, then `pnpm check:source`                               |
| Markdown                                             | `pnpm fix`                                                             |

`pnpm test:dynamodb` is its own vitest project, `dynamodb`, kept out of `pnpm test` and
`pnpm check:quick` the way `smoke` is: the everyday gate needs no container, and it
names the projects it runs, so it cannot claim a DynamoDB run it did not make. The suite
is still mandatory — `check:source` runs it, and so does ci.yml's required `static` job,
against a service container of the same pinned image — and it fails with an instruction
rather than skipping when DynamoDB local is not answering. The in-memory run of the same
contract stays in `pnpm test`.

## Architecture

```
apps/
├── api/         # @instant-composition/api: the Hono app serving contracts' routes under /api
└── web/         # @instant-composition/web: the Vite + React SPA, calling the API under /api
packages/
├── domain/      # @instant-composition/domain: the pure rules, importing nothing
├── application/ # @instant-composition/application: commands, queries and ports
├── adapters/    # @instant-composition/adapters: the DynamoDB and in-memory stores, the catalog
└── contracts/   # @instant-composition/contracts: the HTTP API's zod schemas and OpenAPI
messages/       # the one UI catalog, ja.json, which apps/web renders
content/        # the cards and the lists and guides that define them (see Content)
scripts/        # repository automation, authored as .mjs, never shipped
tests/          # every test, for every package and app (see `placing-tests`)
```

Imports run one way: `apps/api` → `adapters` → `application` → `domain`, with `apps/api`
also naming `application`, `contracts` and `domain` itself, and `contracts` naming no
workspace package. `domain` is the bottom: it names no framework, no npm package and no
Node builtin, so it survives a change of any of them. `apps/web` names none of them: it
reaches the API only over HTTP. Every module is reached by a relative path inside its
own package or app and by the package's name from outside it; there is no path alias.

### The workspace

The repository is a pnpm workspace: the root package holds the tests and the repository
automation, and `pnpm-workspace.yaml` adds each directory under `apps/` and `packages/`.
These are the packages and apps
`docs/architecture/adr/0002-architecture-style-and-repository-layout.md` lays out.
`packages/domain` holds the pure rules, with the practice day computed in the learner's
time zone, and the pure `decide` functions behind each command. `packages/application`
holds the request context, the authorization policy, the practice commands as load,
decide, commit, the queries each screen reads from projections alone, and the ports they
need: the learner-bound store and the catalog. `packages/adapters` implements those
ports: the DynamoDB store on ADR-0006's single table, each commit one
`TransactWriteItems`; the in-memory store; and the catalog that reads one
`pnpm catalog:build` snapshot. Both stores run the contract suite in
`tests/learner-store-contract.ts`, isolation included — the in-memory one in
`pnpm test`, the DynamoDB one against DynamoDB local in `pnpm test:dynamodb`.
`packages/contracts` holds the `/v1` request and response schemas and the OpenAPI 3.1
document built from them, committed as `packages/contracts/openapi.json`;
`tests/contracts-openapi.test.ts` fails when the file differs from what the schemas
generate, and `pnpm contracts:openapi` rewrites it (ADR-0013). `apps/api` serves every
route in contracts' `ROUTES` under `/api` by calling `packages/application`, with a
stand-in authenticator bound to one local learner until Phase 3; `serving-the-api` holds
how. `apps/web` is the browser client ADR-0008 describes: a Vite + React SPA with
TanStack Router, TanStack Query and use-intl over `messages/ja.json`, which reaches the
API only over HTTP under `/api`, typed by what @hey-api/openapi-ts generates from
`packages/contracts/openapi.json` into `apps/web/src/openapi/`. That tree is committed,
`tests/web-openapi-client.test.ts` fails when it differs from a fresh generation, and
`pnpm web:client` rewrites it. `infra/` joins the workspace with its first package.

- **The edges.** `adapters` → `application` and `domain`, the AWS SDK's DynamoDB
  clients, `zod` and `node:fs/promises`; `application` → `domain`; `contracts` → `zod`
  alone; and `domain` → nothing — no workspace package, no npm package, no Node builtin.
  A package reaches another only by its name, `@instant-composition/<dir>`, and only
  when its own `package.json` declares it. The same holds from outside `packages/` and
  `apps/`: `tests/` and `scripts/` never import a package or an app by a relative path,
  which would walk past its `exports`. `eslint.config.mjs`'s `boundaries/packages/*`
  blocks and `tests/boundaries.test.ts` hold the same table, the test also against each
  manifest; a package added under `packages/` fails the suite until it is given a row.
  `apps/api` → `adapters`, `application`, `contracts` and `domain`, `hono`,
  `@hono/node-server` and `node:path`, held the same way by the `boundaries/apps/api`
  block. `apps/web` imports no workspace package: its `src/` reaches React, the router,
  the query cache, use-intl and its UI libraries by exact specifier, its config files
  add Vite and its plugins, and of the trees outside it only `messages/`. The
  `boundaries/apps/web` and `boundaries/apps/web/config` blocks hold the specifiers, and
  `tests/boundaries.test.ts` the resolved paths. An app with source under `apps/` needs
  a row too.
- **Source, not builds.** A package's `exports` points at its `src/index.ts`, and
  whatever consumes it compiles that source — Vite for the web client, Vitest for the
  tests, and Node's own type stripping for `pnpm api`, through the resolve hook
  `scripts/ts-hooks.mjs` registers; nothing but the web client's bundle is emitted. Each
  package and app has its own `tsconfig.json` over the shared `tsconfig.base.json`, with
  no DOM and no Node types — except `adapters`, the one package that does I/O, and the
  apps, which run on Node or in a browser — and `pnpm typecheck` checks every one of
  them after the root's, which covers `tests/` and `scripts/`.
- **The same gates everywhere.** The syntax bans, the named-export surface and the size
  budget in `eslint.config.mjs`, and a coverage floor in `vitest.config.ts`, cover
  `packages/*/src/` and `apps/*/src/` alike. Tests stay under `tests/` and import a
  package or an app by its name, which the root `package.json` declares as a
  `workspace:*` devDependency.

### The seams

Everything this application expects to replace or grow sits behind one of two seams:

- **The Web-standard app.** `apps/api`'s `createApp` returns a Hono app whose `fetch` is
  a plain `(request: Request) => Promise<Response>`, and it takes every dependency — the
  stores, the catalog, the authenticator, the clock and the log sink — as an argument.
  That is what lets a test drive `app.fetch(new Request(…))` with no server and no
  network, and what keeps `apps/api/src/main.ts`, the local entry `pnpm api` runs, a few
  lines of wiring that a hosted entry replaces without touching the app.
- **The environment.** `apps/api/src/env.ts` is the only module under any `src/` that
  reads `process.env`. It validates the whole environment in one place and hands every
  other module what it needs as an argument, so "where does this setting enter the
  process" is a question a reader answers by opening one file. The web client reads no
  environment; its Vite config reads `API_PORT` alone, for the `/api` proxy.

### Rate limiting

This application implements neither rate limiting nor concurrency limiting. It owns no
limiter state, store, algorithm, or rate-limit environment variable. An endpoint that
bills a provider must have its caller-throughput policy enforced at an edge or gateway
before the request reaches the app, with enforcement shared across instances; a
per-process limiter is not equivalent across instances.

### What is contract and what is private

Nothing here is published, so the contract is not an export map. It is what a caller
outside the process can observe, plus what each package publishes to the ones above it:

- **Contract.** Every route `apps/api` serves from `packages/contracts` — its request
  body, its answer, and the `error.code` vocabulary a client branches on, as
  `packages/contracts/openapi.json` records them. The message keys `messages/ja.json`
  defines.
- **Private.** Any module a package's or app's `src/index.ts` does not re-export. A test
  reaches a private module through the surface that owns it, never around it.

No framework here loads a module by its file name, so every surface under a `src/` is
named exports, which is what a reviewer can read a diff of. A tool's config file beside
an app's `src/` — `apps/web/vite.config.ts` — is read through its default export and
sits outside that rule.

These edges are enforced twice and their values are written down in neither this file
nor a skill: `eslint.config.mjs` carries them as `no-restricted-imports` blocks and a
per-file size budget, and `tests/boundaries.test.ts` asserts the same edges from the
module graph, so a rule deleted from that config still fails the suite. Read the numbers
and the patterns there — a summary that restated them is the copy that goes stale. How
to work inside a package or an app is a skill's subject, not this section's.

## Content

`content/` is the data the app reads, through the catalog snapshot `pnpm catalog:build`
writes from it: `cards/<topic>/<subtopic>.json` (one array per cell, sorted by id),
`tombstones.jsonl` (every deleted card, append-only, so an id is never reused), the tag
lists `taxonomy.json`, `levels.json` and `grammar.json`, and the writing and review
guides under `guides/`. A card is shown only when its `stamps.core` hash matches its
current fields — `scripts/cards/schema.mjs` holds that rule, and the snapshot carries
only the cards it admits.

Cards are written only by the three card skills below through `pnpm cards:*`, never by
hand-editing the JSON: the commands assign ids, lint, check for near-duplicates, keep
each file in the one canonical form, and record deletions. Each write command holds
`content/.cards.lock` while it runs, so they run one at a time; a second one fails fast
with `ERR_CARDS_BUSY`. The tag lists and guides are edited by hand, and
`pnpm cards:lint` checks them too.

## Skills

Each skill owns one kind of change. Load the one whose subject you are working on; each
names its own boundary with its neighbours.

| Skill                              | Load it when you are working on                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `building-web-screens`             | a screen, route, query or API call under `apps/web/src/`, or regenerating the client after a contract change                              |
| `localizing-ui`                    | a catalog under `messages/`, a module under `apps/web/src/i18n/`, or adding a UI string                                                   |
| `writing-typescript`               | a `.ts` module or a `.tsx` component under `packages/*/src/` or `apps/*/src/`                                                             |
| `designing-errors`                 | an error type or an `ERR_*` code, in `packages/`, `apps/` or `scripts/`                                                                   |
| `writing-tests`                    | the body of a test under `tests/`                                                                                                         |
| `placing-tests`                    | a new test file, a vitest project, or a coverage floor                                                                                    |
| `type-testing`                     | an `expectTypeOf` assertion or a `@ts-expect-error` inside a test                                                                         |
| `writing-repo-scripts`             | a `.mjs` under `scripts/`                                                                                                                 |
| `authoring-skills`                 | a skill under `.agents/skills/`                                                                                                           |
| `changing-gates`                   | a CI workflow, `lefthook.yml`, or a tool config                                                                                           |
| `managing-dependencies`            | adding, bumping, or removing a package by hand, or pinning `.mcp.json`'s MCP server versions (an open bot PR is `merge-dependabot`)       |
| `merge-dependabot`                 | landing open Dependabot or Renovate pull requests                                                                                         |
| `updating-docs`                    | `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, or whether a change owes a doc at all                                                        |
| `triaging-issues`                  | filing, labelling, or ranking a GitHub issue                                                                                              |
| `designing-ui`                     | the design direction, the theme tokens in `apps/web/src/globals.css`, a shadcn/ui component, or styling any screen                        |
| `shipping-issues`                  | ranking open issues and shipping the top one (or all) through PR, CI, and merge                                                           |
| `steering-the-roadmap`             | choosing what to work on next, reordering phases or scope, cutting a phase into issues, or the project's status; before `shipping-issues` |
| `generating-cards`                 | writing new cards into `content/cards/`, filling thin cells, or adding a subtopic                                                         |
| `reviewing-cards`                  | reviewing, fixing, deleting or stamping cards; `pnpm cards:lint` errors or a non-empty `pnpm cards:queue`                                 |
| `backfilling-card-fields`          | filling a newly declared optional card field across existing cards                                                                        |
| `starting-an-app`                  | turning this template into a new app: the rename, the locales, the design direction                                                       |
| `recording-architecture-decisions` | `docs/architecture/`, or whether a change owes an ADR: a boundary, persistence shape, external contract, provider, or security model      |
| `designing-application-core`       | domain rules, commands, queries, ports and adapters, projections, idempotency, or code that reads the clock or a timezone                 |
| `isolating-learner-data`           | an endpoint, store method, session or token handling, job, or model tool that touches a learner's data                                    |
| `serving-the-api`                  | an operation handler, the request log's fields, the stand-in authenticator, or the local run under `apps/api/`                            |

## Security and human approval

- **Commit, push, and pull request always need a human.** No file this repository ships
  blocks the dangerous spellings — `--no-verify`, a plain force-push, workflow dispatch
  — mechanically; this instruction is the rule itself, not a pattern enforcing it. The
  committed `.claude/settings.json` declares only plugins, and `.mcp.json` only MCP
  servers; an agent may still carry its own personal permission allow/deny list on top
  (a Claude Code session's own `~/.claude/settings.json` or the gitignored
  `.claude/settings.local.json`), but that list is a choice made outside this
  repository, not something it ships or requires.
- The one standing exception to that: invoking `generating-cards`, `reviewing-cards` or
  `backfilling-card-fields` is the owner's authorization to **commit** on a `cards/*`
  branch, and only there. It never authorizes a push, a pull request, or a merge, and
  never `--no-verify`.
- Never take a learner id from a request body, a path, a query string, or a
  language-model tool argument, and never read or write learner data through a store
  that is not bound to the authenticated learner. `isolating-learner-data` holds the
  reasoning and the tests every store and endpoint owes.
- Never read or write `.env*` (the `.example`, `.sample` and `.template` variants are
  fine), anything under `secrets/`, or `.claude/settings.local.json`. A `.env` in a
  checkout may hold a real credential, so reading one is already a disclosure whether or
  not anything is written back: no `cat`, no `grep`, no copy to a temp path, and never a
  value out of it onto a command line. `apps/api/src/env.ts` is the list of names a
  local run reads, and `.env.example` ships every one of them with an empty value —
  those two are what to open when you need to know what exists.
- Never write a credential into a tracked file — no registry auth token, no private key.
- `pnpm-lock.yaml` is generated by `pnpm install`, never hand-edited;
  `managing-dependencies` holds the reasoning.
- Never weaken a gate to make a run pass: no lowered coverage threshold in
  `vitest.config.ts`, no file added to `coverage.exclude` to move a number, no deleted
  security workflow, no removed `--frozen-lockfile`, no removed or relaxed ESLint rule
  or `pnpm-workspace.yaml` supply-chain setting, no `@ts-ignore`, no blanket
  `eslint-disable`, no skipped or deleted test. If a gate is wrong, say so and let a
  human decide.

That last rule stays here rather than moving into a skill, because the agent it has to
reach is looking at a red run and has classified its task as "make CI green" — not as
writing a test or adding a dependency, so neither skill fires. `placing-tests` explains
why there are three separate coverage floors and `managing-dependencies` explains what
each supply-chain setting closes off; the prohibition itself is here.

## Enforcement layers

The rules above are enforced by two layers, from mechanical to procedural. Each layer
holds only what belongs there — the rule itself lives in exactly one place, never copied
between layers:

| Layer                 | Fires on              | Applies to             | Holds                                                                                                 |
| --------------------- | --------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `lefthook` pre-commit | `git commit`          | every author, any tool | Formatting, `eslint`, `typecheck`, `agents:check`, a related-test run, and the one content rule below |
| This file             | read at session start | every agent            | Everything else — the reasons behind the rules above                                                  |

The first row's "every author" is not a second step anybody has to remember, and not
something `prepare` arranges either. `lefthook` ships its own `postinstall`, which
`pnpm-workspace.yaml`'s `allowBuilds` allowlists, so every non-CI `pnpm install` writes
the hook by itself. What that postinstall cannot do is fail: it never reads the exit
status of the `lefthook install -f` it spawns, so an install that could not write the
hook — a `core.hooksPath` pointing somewhere it cannot create — leaves `pnpm install`
green, the gate absent, and nothing on screen. `package.json`'s `prepare` script runs
`scripts/verify-hooks.mjs` after that, and it **verifies rather than installs**: it
fails the install with an `ERR_HOOKS_*` report unless `lefthook.yml` declares a
`pre-commit` block and a lefthook pre-commit hook really sits at the path
`git rev-parse --git-path hooks` names. Both halves are checked because either alone is
satisfiable while the gate is absent — `lefthook install` writes a blank config and
calls that success — and the path is resolved rather than assumed, because
`core.hooksPath` and a linked worktree both move it legitimately.

Verification skips, and the install succeeds, only where it is meaningless: `CI` set, a
directory that is not a Git work tree root, and an install that left no `lefthook` in
`node_modules`. Most of the remaining ways to end up without the gate are deliberate or
visible: `pnpm install --ignore-scripts`, which runs neither lifecycle script;
`ALLOW_MISSING_GIT_HOOKS=1`, the documented opt-out for a developer who genuinely cannot
have the hook, which every failure message names; and hooks removed by hand afterwards.
`LEFTHOOK=0` is not among them: it leaves the hook installed and `verify-hooks` green
while disabling the gate at every commit it is set for — "Two consequences" below is
where that invisibility, and why nothing here closes it, is explained once.
`pnpm hooks:install` is the repair, not a setup step.

No third layer sits under those two: this repository ships no declarative,
tool-call-aware permission list (a Claude Code `permissions.allow`/`permissions.deny` or
equivalent) — "Security and human approval" above is the one place that records what the
committed configuration does declare, and what an agent has to arrange for itself
outside this repository. The one rule that must hold regardless of which tool or human
is committing — a secret about to land in history — is instead the single mechanical
layer this repository does ship: `lefthook`'s pre-commit hook, which every author goes
through the same gate for.

Beside the tree, the GitHub repository's own settings enforce a few things server-side.
No file records them, so no diff shows them change; only the owner changes them:

- A ruleset on the default branch requires a pull request, blocks force-pushes and
  deletion, and blocks the merge until the required checks pass. The required checks are
  `ci.yml`'s jobs, the spell check, the PR-title check, the dependency review and
  GitGuardian. It has no bypass actor, because an agent's `gh` runs with the owner's
  token, so an owner bypass would be an agent bypass too.
- Actions must be pinned to a full commit SHA, including actions nested in composite
  actions, so the pin rule in `tests/workflows.test.ts` also holds at run time.
- Secret scanning with push protection, Dependabot alerts and security updates, CodeQL
  default setup and private vulnerability reporting are on. CodeQL is not a required
  check.

Two consequences of that shape are worth naming rather than discovering: a shell command
that reads a secret path outside a commit (`cat .env`, `cp .env /tmp/x`) is invisible to
the hook, since it only inspects what is staged; and turning the Git hooks off through
the environment (`LEFTHOOK=0 git commit …`) is invisible to the hook it disables, with
nothing else in the repository watching for it. Neither is enforced anywhere. "Never
read or write `.env*` or anything under `secrets/`" and "never bypass the hooks" hold as
instructions in this file, not as blocks — reaching for either spelling is the thing
being ruled out, not the spelling that happens to be caught.

`scripts/lib/guard/` is the rule engine `scripts/check-staged.mjs` (the pre-commit
layer) uses to decide whether a staged path or its content is secret-shaped. That is the
whole of its scope, on purpose.

The hook deliberately does **not** try to stop a commit from deleting a workflow,
relaxing a config, or lowering a threshold. Those are judgement calls, and a judgement
call belongs in the pull request, where a reader can weigh it and disagree — a hook
cannot. A hook that blocks legitimate work teaches its author to reach for
`--no-verify`, and that flag disables the secret check along with everything else, so a
narrow hook that never fires on intended work protects more than a broad one that has to
be routed around. "Never weaken a gate to make a run pass" therefore holds as an
instruction in this file and as something a reviewer checks, not as a block.

Hand-editing `pnpm-lock.yaml` is the clearest example of a rule this repository accepts
as unenforced rather than mechanically blocked: a regenerated lockfile (`pnpm install`)
is an ordinary, expected commit, and a git diff cannot tell that apart from a hand edit
— only a layer that sees the actual tool call that produced the change could, and none
is enforced here. "The lockfile is generated, never hand-edited" holds as an
instruction, the same way the rules above it do.

A skill holds the reasoning behind a rule and the judgment a config cannot express; it
never holds a value a config owns, and never holds a prohibition an agent would meet
while its declared task is something else.

## Conventions

- All committed code, comments, configuration, and public documentation are in English.
  `authoring-skills` applies this to a skill's `description`. One exception is
  `messages/*.json`: those are the UI message catalogs the application renders to a
  reader, so `messages/ja.json` is Japanese by definition. The exception covers the
  catalogs' string values and nothing else — their keys, and every comment, test, and
  document about them, stay English. The same exception, on the same terms, covers the
  string values of `content/`'s JSON (cards, tombstones, and the tag lists), which are
  Japanese learning material by definition; the guides under `content/guides/` stay
  English, quoting Japanese only as the examples they discuss. The one thing that may
  itself be non-English is a literal whose exact bytes are what a check or a worked
  example exercises, where writing it in English would destroy what it demonstrates —
  `tests/placeholders.test.ts`'s `PLACEHOLDERS` is the case to compare against, for the
  reason recorded there. Nothing wider: the prose around such a literal stays English —
  a test's `describe` and `it` names, its assertion messages, its comments, and a
  document's own sentences.

- **A comment carries only what the code cannot** — a non-obvious why, a trap the next
  edit would spring, an external constraint. Default to none and keep the rest to a line
  or two. Restating the code, or narrating decision history, is what the code and git
  already do. TSDoc on the published surface is a contract and stays.

- Do what was asked; nothing more. Prefer editing an existing file to creating a new
  one, and do not add documentation files that were not requested.
- Note improvements you spot outside the current scope instead of making them.
