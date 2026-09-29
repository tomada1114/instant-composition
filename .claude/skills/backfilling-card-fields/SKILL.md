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

The workflow checks both and stops, naming the missing one:

1. The field is declared, with its value check, in `OPTIONAL_FIELDS` in
   `scripts/cards/schema.mjs`, so `pnpm cards:lint` accepts a card that has it.
2. `references/fields/<name>.md` exists with four sections: **What it holds**,
   **Length**, **Examples** (at least three, good and bad), **Review** (the checks a
   reviewer applies).

Writing that spec is the one step that stays in this session, with the owner, before the
workflow runs: it is a decision, not batch work.

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

## Run it as one workflow

The run happens inside the dynamic workflow
`.claude/workflows/backfilling-card-fields.js`. This session only starts it and reports
what it returns. This skill runs only in Claude Code; in a runtime without the Workflow
tool, stop and say so.

1. Call `Workflow({ scriptPath: ".claude/workflows/backfilling-card-fields.js", args })`
   with `args` as a JSON object `{ field, topic?, level?, limit? }`, and wait for its
   completion notice.
2. Report from the returned object: filled, rejected with reasons, batches skipped, the
   commit, the field review summary, any `stop` (quoted, not worked around), and
   `stillMissing`.

## What the workflow does

All agents are Sonnet 5.5 at medium effort (`generating-cards`, "What the workflow
does").

1. **Prepare** — the preconditions, the branch step (`reviewing-cards`'s
   `references/branch.md`), then `pnpm cards:queue --missing <name>`, stamped cards
   first.
2. **Fill** — one filler per 20 cards, in parallel, given the field spec and
   `content/guides/writing.md`, writing `tmp/cards/<name>-<batch>.json`.
3. **Apply** — `pnpm cards:update` per batch, strictly one at a time (each holds
   `content/.cards.lock`). Rejected entries are reported, not retried by hand.
4. **Commit** — `feat(cards): backfill <name> on <n> cards`.
5. **Review** — the `reviewing-cards` workflow runs as a child with `field`.
