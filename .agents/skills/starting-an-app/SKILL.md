---
name: starting-an-app
description: >
  Covers turning this template into a new application: the copy-and-rename procedure
  driven by tests/placeholders.test.ts, what a new project keeps untouched, which locale
  the one catalog under messages/ is in, and settling the design direction before the
  first screen. Use when starting an app from this repository, replacing the package
  name, the app's display name or the repository slug, replacing the ja catalog read by
  apps/web/src/i18n/messages.ts, or replacing the tokens in apps/web/src/globals.css.
---

# Starting an App

**Owns:** turning this repository into a new application — the rename, what the new app
keeps, the locale decision, and when the design direction gets settled. **Does not
own:** how a skill is authored or mirrored (`authoring-skills`); the README's own prose
(`updating-docs`); what a gate file may contain (`changing-gates`); building a screen in
the web client (`building-web-screens`); adding a second locale (`localizing-ui`); what
a settled direction contains and how the tokens are edited (`designing-ui`).

There is deliberately no bootstrap script. The one this repository used to ship was
profile-driven machinery that rewrote the tree and then deleted itself, so the only
record of what it did was a file that no longer existed. What replaced it is this
procedure plus a test holding the list a script would have hard-coded. Do not
reintroduce a script, a profile, or a self-deleting block.

## The order

Rename first, so nothing downstream is written against the template's identity. Decide
the locales next, then settle the design direction before building the first screen of
your own — every screen written against the stock tokens is one to restyle later. Run
`pnpm check:source` once at the end. Each step below names the narrower check to run
while you are inside it.

## The rename

`tests/placeholders.test.ts` owns the inventory: `PLACEHOLDERS` is every string that
names _this template_ rather than a project built from it, and `EXPECTED_INVENTORY` is
the complete list of `<file>: <placeholder>` sites where one still stands. That list is
the checklist, and it is machine-checked, so this skill does not restate its rows —
holding them in two places is how one of them goes stale.

Work through it:

```bash
pnpm exec vitest run tests/placeholders.test.ts
```

The inventory is pinned with an exact comparison, so a failure prints the sites that
remain against the sites the list expects. Replace one site, delete its row from
`EXPECTED_INVENTORY`, run again. You are finished when the list is empty and the suite
is green: an empty inventory means no identity string of this template survived anywhere
in the tree, not merely in the files someone remembered to open.

The suite's second block, over the CI badge and the security-advisory link, checks those
two URLs by their _shape_ — the path segments and the workflow filename — and leaves the
owner and the repository unconstrained. It passes on your slug exactly as it did on the
template's, so it needs no edit during the rename; what pins the slug itself is the
inventory row for each of those files.

What goes into each site:

- **The package identity** — `package.json`'s `name` and `description`. `private: true`
  stays: nothing here is published, so the name only has to be one you recognise, not
  one that is free on the registry.
- **The repository slug**, wherever a URL names a GitHub repository — the README's CI
  badge and the security-advisory contact link in `.github/ISSUE_TEMPLATE/`. A slug left
  behind renders a broken badge and sends a vulnerability reporter to a stranger's
  advisory form.
- **The copyright holder** in `LICENSE`, and the same name wherever the README repeats
  it. Every fork inherits `LICENSE` verbatim, which is why the template ships a blank.
- **The app's display name** — the `Metadata.title` key in the catalog, which `App`
  (`apps/web/src/app.tsx`) writes into the document's title on mount, written in the
  catalog's own language. `apps/web/index.html`'s `<title>` is what shows before the
  script runs, so it changes too.
- **The one-line `description`** — the `Metadata.description` key beside it, which `App`
  writes into `<meta name="description">`.

Those are the only reader-visible strings the inventory covers.

Emptying `EXPECTED_INVENTORY` is the intended edit and is not weakening a gate. Widening
`SKIPPED_DIRECTORIES` or `SKIPPED_FILES`, or dropping an entry from `PLACEHOLDERS`, to
make a row disappear is — the row would stop being reported without the string being
gone. AGENTS.md's "never weaken a gate to make a run pass" covers that.

## What the new app keeps

Everything below is about the repository rather than the application, so it survives the
rename unchanged and is most of what starting from this template buys:

- **The gate set** — `package.json`'s `check:quick` / `check:source` and the scripts
  they call, `lefthook.yml`, and `.github/workflows/`. A red run early in a new project
  is an argument for fixing the code, never for deleting the check that found it.
- **The guard engine** — `scripts/lib/guard/` and `scripts/check-staged.mjs`, the one
  mechanical layer this repository ships and the only thing standing between a secret
  and the commit history. It is language-agnostic; keep it whatever the app becomes.
- **The skills** under `.agents/skills/` and their generated mirror. Drop one only when
  the subject it owns actually leaves the repository. **REQUIRED:** `authoring-skills`
  for the loop that keeps the two trees identical, and for the AGENTS.md Skills table
  row that `tests/skills-frontmatter.test.ts` requires in both directions.
- **The label workflow** — `.github/labels.yml`, `scripts/sync-labels.mjs` behind
  `pnpm repo:labels`, and `.github/workflows/pr-label.yml`. Run `pnpm repo:labels`
  against the new repository early: the workflow only ever _applies_ a label, and when
  one does not exist yet it emits a notice instead of failing, so a missing taxonomy is
  silent. **BACKGROUND:** `triaging-issues` for what the labels mean.
- **`.env.example`**, even when the app reads nothing new yet. `apps/api/src/env.ts` is
  the only module that touches `process.env`, and `tests/env-example.test.ts` asserts
  the two stay in step; the example file is half of that check.

## The locale decision

The app ships one catalog, `messages/ja.json`, and keeps the locale out of the URL
(ADR-0008). Keeping it is the default. An app whose learners read another language
replaces it rather than adding a second, and that touches:

- `messages/ja.json`, replaced by `messages/<locale>.json` translating every key.
- `apps/web/src/i18n/messages.ts` — the static import of the catalog and `LOCALE`.
- `apps/web/index.html`'s `<html lang>`, and `tests/stack-smoke.test.ts`, which asserts
  it.
- `tests/messages.test.ts` — it reads `messages/<LOCALE>.json`, but also names `ja`
  literally as its reference catalog; `MESSAGE_KEYS` changes only if the keys do.
- `README.md`'s quick start, and AGENTS.md's Conventions exception, which names
  `messages/ja.json` as the one committed file that is not in English.

`pnpm typecheck` then checks every `t()` call against the new catalog's shape. Check
with:

```bash
pnpm exec vitest run tests/messages.test.ts
pnpm typecheck
```

A second locale beside the first is not part of starting an app: where the choice
between them comes from is the open part of ADR-0008. **BACKGROUND:** `localizing-ui`.

## Settling the design direction

The template ships shadcn/ui's stock `neutral` tokens and an unsettled lock in
`designing-ui`, both carrying the design-direction marker that `PLACEHOLDERS` in
`tests/placeholders.test.ts` lists — so the same inventory run as the rename reports it,
one row for `apps/web/src/globals.css` and one per copy of `designing-ui`'s `SKILL.md`.

Settle it before the first real screen, and research it rather than choosing by taste:
the user-level `refero-design` skill is the method when it is installed, and the choice
is the human's either way — present the options and let them pick. Then:

- Fill `designing-ui`'s lock and ledger in the shape that section gives, and replace the
  marker sentence and the paragraph under it with the settled direction. Edit the
  `.agents/` copy and run `pnpm agents:sync`.
- Replace the stock values in `apps/web/src/globals.css`, keeping the `:root` +
  `@theme inline` shape, and replace its marker comment with one naming the direction.
  Fonts are `@fontsource-variable/*` packages imported by `apps/web/src/main.tsx` and
  bundled, so a family changes by swapping the package (under `managing-dependencies`),
  its import, and its name in `globals.css`.
- Restyle `apps/web/src/ui/button.tsx` to the settled recipe, dropping any variant the
  lock has no use for, and update `tests/web-ui-primitives.test.tsx` in the same edit.
- Delete the marker's rows from `EXPECTED_INVENTORY`. The marker stays in `PLACEHOLDERS`
  so it cannot come back unnoticed.

```bash
pnpm exec vitest run tests/placeholders.test.ts tests/web-ui-primitives.test.tsx
pnpm db:up && pnpm web:build && pnpm test:smoke
```
