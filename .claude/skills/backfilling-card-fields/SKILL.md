---
name: backfilling-card-fields
description: >
  Use when a new optional field is added to the instant-composition card schema and
  existing cards under content/cards/ need it filled in, or when running
  /backfilling-card-fields with a field name. Covers writing the field spec under
  references/fields/, filling the field in batches, and handing it to review.
---

# Backfilling Card Fields

**Owns:** filling one newly added field across existing cards, and the per-field spec
that says what goes in it. **Does not own:** adding the field to the schema and the lint
(`scripts/cards/`, `writing-repo-scripts`); reviewing the filled field
(`reviewing-cards --field`); new cards (`generating-cards`, whose writer brief must
start asking for the field once it exists).

Invoking this skill is the owner's authorization to **commit** on a `cards/*` branch. It
never authorizes a push, a pull request, or a merge.

## Preconditions

Stop and say which is missing if either is:

1. The field is declared, with its value check, in `OPTIONAL_FIELDS` in
   `scripts/cards/schema.mjs`, so `pnpm cards:lint` accepts a card that has it.
2. `references/fields/<name>.md` exists with four sections: **What it holds**,
   **Length**, **Examples** (at least three, good and bad), **Review** (the checks a
   reviewer applies). Write it with the owner first if it does not exist.

## Arguments

```
/backfilling-card-fields <name> [topic=…] [level=…] [--limit <n>]
```

`--limit` defaults to 200.

## Why a backfill never hides a card

A card's `stamps.core` covers only the core fields, and a backfilled field gets its own
`stamps.<name>`. Filling the field leaves `stamps.core` valid, so the card keeps being
shown; the app displays the new field only once its own stamp matches. Ten thousand
cards can take the field without the drill pausing.

## Procedure

The filling is done by `card-writer` agents (`generating-cards`, "Who does what"), one
per 50 cards; this session runs the commands and git.

1. **Branch.** Follow `reviewing-cards`'s
   [references/branch.md](../reviewing-cards/references/branch.md).
2. `pnpm -s cards:queue --missing <name> [range] --limit <n> --json > tmp/cards/fill.json`
   — cards without the field, stamped cards first. Split it into
   `tmp/cards/fill-<b>.json` of at most 50 entries each (the same one-liner as
   `reviewing-cards` step 3).
3. Spawn one `card-writer` per batch, in parallel: "Fill the field `<name>` for every
   card in `tmp/cards/fill-<b>.json`, following
   `.claude/skills/backfilling-card-fields/references/fields/<name>.md` and
   `content/guides/writing.md`. Output `[{ "id": …, "<name>": … }]` to
   `tmp/cards/<name>-<b>.json`."
4. `pnpm -s cards:update tmp/cards/<name>-<b>.json` per batch, one at a time. Rejected
   entries are reported, not retried by hand. A missing or unparseable file gets one
   message back to its writer; if still bad, skip the batch and report it.
5. Commit: `git add content`; if `git diff --cached --quiet` reports nothing staged,
   skip it. Otherwise `git commit -m "feat(cards): backfill <name> on <n> cards"`.
6. Run `reviewing-cards --field <name>`. **REQUIRED:** `reviewing-cards`.
7. Report: filled, rejected with reasons, batches skipped, the field review summary, and
   `pnpm -s cards:queue --missing <name> --count`.
