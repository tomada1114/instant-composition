---
name: changing-gates
description: >
  Covers editing a file that enforces rather than implements: a .github/workflows/*.yml
  CI workflow, lefthook.yml, or a setting inside eslint.config.mjs, tsconfig.json,
  vitest.config.ts, .prettierrc.json, or apps/web/vite.config.ts. Use when a CI job or a
  deploy workflow is proposed, a step is added to check:source or ci.yml, a lefthook
  stage or glob changes, an ESLint rule, a boundary row or a vitest project is added or
  loosened, or the question is which gate would have caught a change — including what
  none of them sees, such as the Vite /api proxy and anything needing a running stack.
---

# Changing Gates

**Owns:** a change to a file that enforces rather than implements — a CI workflow,
`lefthook.yml`, or a tool config (`eslint.config.mjs`, `tsconfig.json`,
`vitest.config.ts`, `.prettierrc.json`, `apps/web/vite.config.ts`) — and which gate can
see a given change at all. **Does not own:** adding a dependency the config then
configures (`managing-dependencies`); a coverage floor's value or which vitest project a
test joins (`placing-tests`); a `.mjs` under `scripts/` that a gate invokes
(`writing-repo-scripts`); what the web client's dev server and proxy serve
(`building-web-screens`); `.github/labels.yml` (`triaging-issues`).

## The one rule every gate change shares

A gate file may narrow _what_ a tool looks at; it may never define a rule of its own.
`lefthook.yml`'s header states this for the hook layer, and it is equally true of CI,
which runs the same package scripts as separate steps. Adding a check therefore means
adding a package script and calling it from the gate, never inlining a command into a
workflow step or a hook line.

## `check:source` and `ci.yml` are one list written twice

`package.json`'s `check:source` composes as one script the same ground
`.github/workflows/ci.yml` covers as separate `run:` steps — split there so a reader
sees which step failed rather than only that the composite did. `tests/ci-sync.test.ts`
holds the two together, both ways: it extracts every `pnpm run <name>` token out of
`check:source` and out of every job `ci.yml` declares — the job list is parsed from the
file rather than named in the test, so a third job counts the day it lands — and fails
when a step on either side has no counterpart on the other.

The exceptions are two maps, one per direction, each value a stated reason rather than a
comment: `CHECK_SOURCE_ONLY_EXCEPTIONS`, empty today, and `CI_ONLY_EXCEPTIONS`, which
holds `test`. That one is ci.yml's `Run tests without coverage` step, the
`matrix.os != 'ubuntu-latest'` branch that keeps coverage collected exactly once should
a second OS join the matrix; `check:source` runs `test:coverage`, the same suite plus
the coverage floors, so a local run is not missing a gate. Adding an entry to either map
is a claim to argue in the PR, and a stale one fails the suite — each key has to still
name a real step on its own side.

A new gate is therefore three edits, not one: the package script, the `check:source`
composition, and the matching `ci.yml` step — and the suite now fails if either of the
last two is skipped, whichever way round. What it does not judge is _which_ job a CI
step lands in: steps are collected across all jobs, so a check that belongs in `static`
but sits in `test` satisfies both directions. That one is still read by a human.

## CI workflows

`tests/workflows.test.ts`'s `lintWorkflow` is the mechanical half, and it is cheaper to
read before writing a workflow than after the run goes red. It rejects, each with its
own `ERR_WORKFLOW_*` code:

- `pull_request_target` anywhere — it runs fork code with a writable token.
- an action not pinned to a 40-character commit SHA, or pinned with no trailing
  `# vX.Y.Z` comment saying which release that SHA is. A local `./…` action is exempt,
  having no SHA to pin.
- a missing top-level `permissions`, or one wider than `{}` or `contents: read`.
- a job that declares no `permissions` of its own, or grants `write-all`.
- a workflow that declares no jobs at all, and a job whose steps the scanner cannot
  reach — every step rule reads the same step list, so a job it cannot read is a hole in
  all of them at once and is reported rather than passed. A job that calls a reusable
  workflow through its own `uses:` is exempt, having no steps to find.
- a job with no `timeout-minutes`. A step-level timeout does not substitute.
- an `actions/checkout` step without `persist-credentials: false`.
- `actions/setup-node` ordered before `pnpm/action-setup`, whose failure mode is a
  silently empty store cache rather than an error.
- a `pull_request` workflow with no `concurrency`; and, on any workflow that runs on
  `push` at all — push-only included — an unconditional `cancel-in-progress`: killing a
  push run destroys the only CI record a merged commit gets, and a push-only workflow
  has no pull-request run to fall back on. Both rules read every declaration GitHub
  Actions accepts, the workflow's own and each job's, in the block spelling and in the
  flow mapping alike. The flow mapping has to be one physical line with balanced braces.
  Only two shapes are read at all — a flow collection whose braces balance on its own
  line, and a plain scalar taken at face value — and anything else is refused as
  `ERR_WORKFLOW_CONCURRENCY_UNREADABLE`, the same way an unreadable `on:` or trigger
  entry is refused as `ERR_WORKFLOW_ON_UNREADABLE`. The `on:` check reads the header,
  every outermost sequence entry or mapping key, and every flow entry; it does not read
  event bodies such as `branches:` or `types:`. That covers a flow collection continued
  onto the next line or unbalanced because a quoted value carries a brace, one left
  unbalanced by a collection that opens part-way along the value rather than at its
  first character, and a value led by a YAML anchor, alias or tag (`&`, `*`, `!`) — none
  of which is the scalar the rules behind the check would otherwise take it for.
  Refusing the class rather than widening the detector is deliberate: an alias carries
  no brace at all, so a detector hunting for one would still pass it, and teaching the
  group and cancel readers to look past an indicator is the same flow-scalar parser this
  bullet ends by ruling out. Being readable is a property of the whole declaration, not
  of its first line: the `group:` and `cancel-in-progress:` values are read wherever
  they are written — in the header's inline value, in a one-line flow mapping's entry,
  or on their own body line — and each is refused on the line it sits on, under that
  same code. Only those two keys are checked, since they are the only values the two
  rules read. An unreadable header is the exception that reports once: the lines under a
  value already refused are fragments of it rather than values of a declaration this
  lint has read. That refusal does not silence the cancel rule: the cancel-on-push loop
  still reads an unreadable block's body, so a spelling it happens to catch — an
  unconditional `cancel-in-progress: true` sitting on its own line — is reported
  alongside it as `ERR_WORKFLOW_CONCURRENCY_CANCELS_PUSH`, both codes on the same block
  rather than one hiding the other. Nor does it silence the missing-concurrency rule
  wholesale: that one is suppressed only by a `group:` question this lint could not
  read, so a block naming no group and carrying an unreadable `cancel-in-progress` is
  reported under both codes. Rejoining physical lines into one flow value is a
  flow-scalar parser this repository has decided not to write. A workflow-level block
  covers every job and a job-level one covers only its own, so declaring it per job
  answers the first rule only when every job does, and only when the block names a
  `group:` — a bare `concurrency:` key queues nothing. Any block cancelling
  unconditionally trips the second, except on a job whose own `if:` pins it to a pull
  request: that job never runs on push, so no push record is what its cancellation
  discards.
- a multi-line `run:` that neither opens with `set -euo pipefail` nor runs under a
  fail-closed `defaults.run.shell`. `shell: bash` is not enough: it leaves `-u` off.
- a `pnpm … install` without `--frozen-lockfile`, which would make every other gate
  advisory.

Reading each of those blocks is `blockOf`, and indentation is not all it goes on: YAML
lets a block sequence start in the same column as the key it belongs to, so a key
awaiting a block value claims same-column `- ` entries as well as more deeply indented
ones. That is what keeps `steps:` written at its own column from reading as a job with
no steps, and it is why a fix for one such blind spot belongs in `blockOf` rather than
in the caller that noticed it.

Those rules hold for **every** workflow this repository ever gains, a deploy workflow
included: the suite runs `lintWorkflow` over whatever `.github/workflows/` contains. Two
lists in that file are exact and only a human edits them.

- The filename list in "includes every workflow spec 02 §5.2 makes mandatory" is
  compared with `toEqual`, so a new workflow file fails the suite until it is added
  there. That failure is the review prompt, not an obstacle to route around.
- The writers list in "grants a write scope only where the job cannot do its work
  without one" is `["pr-label.yml"]` today. A workflow carrying any `: write` scope has
  to join it — a deploy workflow that pushes, tags, or comments included.

The judgment half no test encodes:

- A new workflow file is warranted only when the work does not belong as a job inside
  `ci.yml` — a different trigger shape or a genuinely separate permission footprint, not
  a convenience split.
- Widening write access, or adding a second workflow that writes, is a security-relevant
  change and needs the weight of review a new write grant deserves, not a routine CI
  edit.
- A PR that deletes or narrows a security-relevant step (the pin, the `permissions`
  block, `persist-credentials: false`, a timeout) must say in its own body why the
  removed protection no longer applies here. Silence is not review for that.

The default branch's ruleset (AGENTS.md's "Enforcement layers") requires checks **by
name**. A job's `name:` — the matrix suffix included, as in `Test (ubuntu-latest)` — is
therefore part of the merge gate. Renaming a required job, splitting it, or adding a
second OS to the matrix leaves the ruleset waiting for a check that never reports, and
every pull request stays unmergeable while CI shows green. A change like that says in
its body which required check it renames, so the owner updates the ruleset in the same
sitting. Adding a job does not make it required; that is the owner's call too.

## `lefthook.yml`

The hook is deliberately narrow, and AGENTS.md's "Enforcement layers" holds the argument
for why. The bar for a new or changed job follows from it: it must never fire on
intended work — test it against a normal commit before trusting it to catch a bad one.

A changed job only reaches an author whose clone has the hook, and what puts it there is
lefthook's own `postinstall`, allowlisted in `pnpm-workspace.yaml`, on every non-CI
`pnpm install`. Nothing here re-installs it: `package.json`'s `prepare` script runs
`scripts/verify-hooks.mjs`, which **verifies and never writes**, because the defect
issue #81 was really about is that lefthook's postinstall cannot fail — it ignores the
exit status of the `lefthook install -f` it spawns, so a hook that could not be written
leaves the install green and silent.

The verifier checks both halves, and neither is redundant. `lefthook.yml` has to declare
a `pre-commit` block, because `lefthook install` run without a config _creates a blank
one_, reports success and exits 0 — an empty gate that installs cleanly. And a lefthook
pre-commit hook has to exist at the path `git rev-parse --git-path hooks` resolves to,
which is asked rather than assumed: `core.hooksPath` set to a writable directory is
perfectly fine and is not a defect, and a linked worktree's hooks live in the shared
common directory. Verification skips only where it is meaningless (`CI` set, not a Git
work tree root, no `lefthook` in `node_modules`) and otherwise fails the install with an
`ERR_HOOKS_*` report naming `ALLOW_MISSING_GIT_HOOKS=1`, the one deliberate opt-out.
`tests/verify-hooks.test.ts` pins that behaviour against throwaway `git init`
repositories and the real lefthook, the `prepare` entry included; it isolates `HOME` and
`XDG_CONFIG_HOME` rather than relying on `isolatedGitEnv`, which strips `GIT_*` and so
cannot keep a developer's global `core.hooksPath` out of a fixture repository.

Pointing `prepare` at an installer instead is the change to reject: it repeats what
lefthook already does, and repeats it just as silently, which leaves AGENTS.md's "every
author, any tool" row resting on an install nobody checked.

Job ordering is load-bearing rather than incidental. `format` runs alone before the
parallel group so `eslint`, `typecheck` and `check:staged` see the formatted, re-staged
blobs rather than the working tree as it stood before the commit began. Preserve that
shape across an edit instead of parallelizing it away. A job that inspects file
_content_ — `check:staged` today — must stay in the group that runs after `format`.

Two jobs carry no `glob` on purpose: `check:staged` has to see every staged path
whatever its extension, and `test:related` has to see the paths themselves to work out
what is related, including a staged test file with no production counterpart. Adding a
glob to either narrows it in a way nothing reports. When a new extension enters the tree
(`.tsx` did), the globbed jobs are the ones to revisit.

## What `check:staged` actually covers

`scripts/check-staged.mjs` inspects the git index: for each staged change it classifies
the **path** through `scripts/lib/guard/paths.mjs`'s `checkCommit` (the `.env*`,
`secrets/**`, and `.claude/settings.local.json` shapes, **minus direnv's bare
`.envrc`**) and, when the path passes, the staged **blob content** through
`scripts/lib/guard/credentials.mjs`'s `checkCredentials`. `checkCommit` shares one body
with the agent-read rule `checkRead` and differs from it on that single basename: a
direnv project tracks its `.envrc` on purpose, so this layer judges it on content, while
`checkRead` still refuses to open it. That is the whole of its scope. It judges nothing
about whether a commit weakens a gate — that is the pull request's job.

Two properties are worth knowing before relying on it or editing it:

- It rejects a file on its **basename alone** when the name looks like a private key —
  `KEY_FILE_SUFFIXES` and `KEY_FILE_BASENAMES` in `check-staged.mjs`, matched
  case-insensitively — because such a file may be binary or encrypted and so cannot be
  relied on to trip the content patterns. That rule lives in `check-staged.mjs` itself,
  **not** under `scripts/lib/guard/**`, so it sits under the broader `scripts/**`
  coverage floor rather than the stricter guard floor. A change to it needs its test
  written deliberately; the aggregate floor will not ask for one.
- `checkStagedChange` returns `null` for `change.status === "D"`. **A staged deletion is
  never inspected** — deleting a secret-shaped file, a workflow, or a test passes this
  layer untouched, by design. Nothing else in the repository watches for it either.
- The generic hardcoded-password rule judges the **value**, not the key. A key ending in
  `password`, with an optional surrounding quote and a `:` or `=` separator, only makes
  a site a candidate; `isCredentialShapedValue` then decides. A value qualifies when it
  is at least eight characters, is an unbroken run of printable ASCII, opens no
  interpolation, and mixes at least three of four character classes — lower case, upper
  case, digits, punctuation — with `.` and `_` counted as neither, since they are what
  an identifier is made of. Three classes is what separates a generator's output from
  the strings people deliberately write next to a password key: a kebab-case identifier
  (the `new-password` autocomplete value a sign-in form carries), a README placeholder,
  a masked display value and a URL each mix two and pass.
- The expression markers — a dollar sign, a backtick, brackets, braces, angle brackets —
  reject a **bare** value outright, because there they mean the right-hand side is code.
  They do not reject a quoted one: inside quotes a generated password carries them as
  content, so a quoted body is rejected only on a real interpolation opener (`${`, `$(`,
  a backtick). A bare value is captured to the next whitespace and then stripped of a
  trailing `,` or `;`, so a value holding one is judged whole rather than truncated
  below the length floor.
- One shape the class test cannot reach is bought back by context instead: an upper
  snake case key ending in the env-style password name, assigned a bare alphanumeric
  word of eight characters or more that runs to the end of its line, is blocked. That is
  the compose-file, CI-service and env-file service credential, where a single
  lower-case word is the whole secret and no shape test could tell it from a
  placeholder; the context does the work an eight-character word cannot. A `,` or `;`
  continuing a JavaScript object or type takes the site back out. It is the one place
  the key's shape decides anything, and the cost comes with it: a bare eight-character
  placeholder under such a key is blocked too, and the way past that is an empty value,
  the convention `.env.example` already follows.
- What the rule therefore does **not** cover: a secret under eight characters; one
  mixing only two character classes, which includes a lower-case word with digits stuck
  on the end unless it sits under an upper snake case key; one holding a space or a
  non-ASCII character; one assembled by interpolation; a body whose quote is escaped;
  and the whitespace-separated schema form, which is a type declaration rather than an
  assignment and is excluded on purpose. A real password that also reads as an
  identifier or as a placeholder therefore walks through. That is the deliberate half of
  the trade: ordinary code — a schema field, a type member, a destructured read — and
  the placeholder strings documentation is written with are no longer blocked, and a
  hook that fires on intended work teaches its author to reach for `--no-verify`, which
  switches off every rule in `credentials.mjs` at once.

## Tool configs

Each of `eslint.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.prettierrc.json` and
`apps/web/vite.config.ts` holds its own current values — read the file rather than a
copy of a rule written elsewhere. A PR changing one owes three things in its body: which
rule or option moved, why, and what now passes or newly fails that did not before.
AGENTS.md governs whether the change is allowed at all; this skill does not restate
that.

Traps that have cost time here:

- In `eslint.config.mjs`, `no-restricted-syntax` and `no-restricted-imports` **replace**
  their options across config objects rather than merging. A narrower block that sets
  either rule silently switches off every entry it does not restate — which is why
  `NO_ENUM` and `NO_EXPORT_STAR` are shared constants and why the `boundaries/*` blocks
  match disjoint file sets. Keep a new block disjoint from them, or restate what it
  still wants.
- Anchor a relative pattern with a leading `../`. Unanchored, `**/server` would also
  match a package subpath such as `react-dom/server`; `../**/server` cannot match any
  bare specifier. `no-restricted-imports` matches specifier text through the `ignore`
  package rather than resolving it, and `ignore` treats a leading `./` as a different
  string from a leading `../` — so `./../server` is invisible to `../**/server` even
  though it resolves to the same module. `zonePatterns()` therefore generates a
  `./../**` twin of each `../**` pattern; a bare specifier still cannot start with
  `./..`, so the twin is exactly as safe as the pattern it doubles.
- There is no path alias. Every module under `apps/*/src/` and `packages/*/src/` is
  reached relatively inside its own tree and by `@instant-composition/<dir>` from
  outside it. An alias added back would be a spelling no pattern above names, and every
  resolver — `tsconfig.json`'s `paths`, Vite, Vitest, this config — would have to be
  told about it separately; that is a boundary change, not a convenience.
- `eslintConfigPrettier` must stay the last element of the exported array. Anywhere else
  it stops turning off the stylistic rules that would fight Prettier, and the two gates
  then disagree about the same file.
- A shared config spread in unscoped applies to `scripts/**` and `tests/**` as well. The
  web client's React rules are the `web/react` block — `eslint-plugin-react-hooks`' flat
  `recommended`, scoped to `apps/web/**`; a React or accessibility plugin added later
  gets the same scoping.
- The named blocks are the map: `src/shared-syntax`, `src/size-budget`,
  `public-api/explicit-surface`, `web/react`, `boundaries/packages/<dir>` (one per
  workspace package), `boundaries/apps/<dir>` (one per app holding source, plus
  `boundaries/apps/<dir>/config` for an app whose config files import build tools),
  `boundaries/private-trees-are-not-importable`, `automation/node-scripts`,
  `tests/vitest-rules`, `tests/relaxations`. The per-package and per-app blocks match
  disjoint file sets by construction; `boundaries/private-trees-are-not-importable`
  covers `tests/` and `scripts/` and restates `NO_RELATIVE_PACKAGE_IMPORT` — a relative
  path into `packages/` or `apps/` — because the rule's options replace rather than
  merge. Name a new block the same way — the name is what a reader, and ESLint's own
  config inspector, has to identify it by.
- `src/shared-syntax`, `public-api/explicit-surface` and `src/size-budget` match
  `SOURCE_FILES`, every `packages/*/src/` and every `apps/*/src/`: a rule meant for the
  application's own source belongs there, so moving a module from a package into an app
  never drops it. An app's config file beside its `src/` (`apps/web/vite.config.ts`) is
  outside them, which is what lets Vite read its default export. The
  `boundaries/packages/*` blocks are generated from `WORKSPACE_EDGES`, `NPM_EDGES` and
  `NODE_EDGES`, the `boundaries/apps/*` blocks from the `APP_*` tables the same way.
  Each refuses every bare specifier but an allowed name through a `regex` pattern — a
  gitignore-style `group` cannot say "anything but these" — and a relative path into
  another package or app through a `group`. The group reads specifier text, so a climb
  out of the package it does not name still passes lint; `tests/boundaries.test.ts`
  resolves every relative specifier and is the check that sees it.
- `tests/boundaries.test.ts` holds the same tables, asserts them from the module graph
  and against each manifest, and gives every directory under `packages/` and `apps/` a
  row: a new package or app fails the suite until it is given one, which is the boundary
  decision it needs. It pins rows rather than files, so a legal new module inside a
  package never trips it.
- `vitest.config.ts` runs five projects — `unit`, `component` (jsdom), `automation`,
  `smoke`, `dynamodb` — and coverage is collected once for the whole run, never per
  project. The default run (`test`, `test:coverage`, `test:watch` and `test:related`)
  names `unit`, `component` and `automation` and so leaves out `smoke`, which serves
  `pnpm web:build`'s output in front of the API on DynamoDB local, and `dynamodb`, which
  needs DynamoDB local; ci.yml's `test` job has neither. They are named rather than
  negated because a second `--project='!name'` does not narrow the first, and
  `tests/ci-sync.test.ts` fails when a project is named by none of `check:source`'s test
  steps. Which project a file joins, and the value of any threshold, are
  `placing-tests`. What belongs here is that `extends: true` is what carries the shared
  `allowOnly`/restore/unstub settings into a project: a hand-written project object
  without it drops them silently.
- `apps/web/vite.config.ts` is a gate as well as a build config: `envDir: false` is what
  keeps Vite from loading any `.env*` file, which AGENTS.md keeps every tool off. Its
  `server` and `preview` blocks share one `/api` proxy, and the smoke suite serves
  through `preview`, so a change to one and not the other is a dev server the smoke
  suite no longer describes.

## What no gate here sees

No check here boots a browser, and only one runs the whole stack: `pnpm run test:smoke`
serves the last `pnpm web:build` with `vite preview` in front of the API, started as
`pnpm api` starts it, on DynamoDB local, and asserts over `fetch` that the document is
served dark-only and in Japanese, that any client route gets that same document, that it
links a stylesheet carrying a Tailwind utility the client uses, and that a round trip
through the `/api` proxy saves, starts, records and reads back — plus one contract
refusal and the bare unmatched `404`. The stylesheet case is the only check that sees
Tailwind run at all: a component test renders a `className` into the DOM whether or not
any CSS was generated. That is the whole of what a running stack is checked for — the
seams between the layers, not their behaviour, which each layer's own suite owns.

It runs from `check:source` and from ci.yml's `static` job, both times immediately after
`Build the web client`, and from neither `pnpm test` nor `pnpm check:quick`: the bundle
is what it serves, so a run without one would either fail or pay for a second build. It
never builds for itself — it compares `apps/web/dist/index.html` against the client's
source, `index.html`, `vite.config.ts`, `package.json` and `messages/`, refuses a
missing or stale bundle, and refuses to start without DynamoDB local, which is how the
caller stays the only one paying for either. A green `check:quick` therefore still says
nothing about anything only a running stack shows.

The same holds for DynamoDB. `pnpm run test:dynamodb` runs the learner-store contract
suite against the DynamoDB adapter on DynamoDB local, and the API over it, and only
there: from `check:source` after `pnpm db:up`, and from ci.yml's `static` job, whose
`services:` container runs the image `compose.yaml` pins by tag and digest
(`tests/workflows.test.ts` holds the two references equal). The container sits on
`static` rather than `test` because a service container needs a Linux runner and `test`
is an OS matrix. A green `check:quick` says nothing about how the adapter behaves
against a real engine.

Everything outside those assertions is still a place a change can be wrong while every
gate passes. A gate proposed to close such a gap is a real gate, not a lint rule, and
belongs in the PR as such.
