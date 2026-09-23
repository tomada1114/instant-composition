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

1. **Branch.** As in `generating-cards` step 1.
2. `pnpm cards:queue --missing <name> [range] --limit <n> --json` — cards without the
   field, stamped cards first.
3. Batch by 20. For each batch, one writer sub-agent (the `executor` agent in Claude
   Code when defined) gets the field spec, `content/guides/writing.md`, and the cards;
   it returns `[{ "id": …, "<name>": … }]`.
4. Save to `tmp/cards/<name>-<batch>.json`, `pnpm cards:update` it. Rejected entries are
   reported, not retried by hand.
5. After all batches: run `reviewing-cards --field <name>`. **REQUIRED:**
   `reviewing-cards`.
6. Commit: `feat(cards): backfill <name> on <n> cards`.
7. Report: filled, rejected with reasons, reviewed, and what
   `pnpm cards:queue --missing <name> --count` still lists.
