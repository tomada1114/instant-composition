---
name: reviewing-cards
description: >
  Use when asked to review, check, proofread, fix, or stamp instant-composition cards
  under content/cards/, when pnpm cards:lint reports errors, when unreviewed or changed
  cards are waiting in pnpm cards:queue, when a single card looks wrong while using the
  app, or when content/guides/review-perspectives.md changed its perspectivesVersion.
---

# Reviewing Cards

**Owns:** deciding whether each card stays, is edited in place, is rebuilt, or is
deleted, applying that, and stamping the cards that pass. **Does not own:** planning and
writing new cards (`generating-cards`); filling a new field (`backfilling-card-fields`,
which hands its field to this skill for review).

Invoking this skill is the owner's authorization to **commit** on a `cards/*` branch. It
never authorizes a push, a pull request, or a merge. Edits, rebuilds and deletions are
applied without asking; git is the undo.

## Arguments

```
/reviewing-cards [topic=…] [subtopic=…] [level=…] [--ids <id,id,…>] [--note "<text>"] [--field <name>] [--limit <n>]
```

- No arguments: the default queue, at most 50 cards.
- `--ids` reviews exactly those cards, stamped or not. `--note` attaches the owner's
  observation to every listed card; every reviewer sees it.
- `--field <name>`: review only that backfilled field (see "Field review").

## Read first

`content/guides/writing.md` (what a good card is), `content/guides/identity.md` (edit
vs. rebuild), `content/guides/review-perspectives.md` (the checks and the current
`perspectivesVersion`).

## Procedure

1. **Branch.** As in `generating-cards` step 1: never on `main`, stop on stray changes
   outside `content/`.
2. **Lint everything.** `pnpm cards:lint`. ERROR cards join this run first.
3. **Queue.** `pnpm cards:queue [range] [--ids …] --limit <n> --json` returns, in order:
   lint-ERROR cards, never-stamped cards, cards changed since their stamp, cards stamped
   under an older `perspectivesVersion` — each as `{ reason, errors, card }`, with the
   lint findings in `errors`. With `--ids`, every listed card is returned, current ones
   last.
4. **Batch** the queue into groups of 10–20 cards. For each batch:
   1. `pnpm cards:dupes --ids <batch ids> --json` for R3's near-duplicate candidates.
   2. Run **R1, R2 and R3 in parallel**, each a separate sub-agent that did not write
      these cards and never sees another reviewer's output. Briefs are in
      [references/reviewer-briefs.md](references/reviewer-briefs.md). In Claude Code, R1
      uses the `executor` agent and R2/R3 the `architect` agent when those are defined;
      otherwise general-purpose sub-agents.
   3. **Adjudicate** every card yourself — keep, edit, rebuild, or delete — using
      `identity.md` for edit vs. rebuild. For R1, compare each blind sentence's skeleton
      with `en`: a different skeleton means fix `ja` or add an alternative; a natural,
      likely same-skeleton answer missing from `alternatives` is worth adding (keep
      2–3). A `low`-confidence finding with no second reviewer agreeing may be
      dismissed. Record every overruled `REBUILD`/`DROP` with a one-line reason.
   4. **Apply**:
      - Edit in place: write `[{ "id": …, <changed fields> }]` to
        `tmp/cards/edits.json`, then `pnpm cards:update tmp/cards/edits.json`.
      - Delete: `pnpm cards:tombstone --id <id> --reason "<one line>"`.
      - Rebuild: brief one writer with the writer brief (**REQUIRED:**
        `generating-cards`, its `references/writer-brief.md`) for 1 card in the same
        cell, adding the reviewers' findings and the old card;
        `pnpm cards:add <file> --replacing <old>` (so the rebuild is not dropped as a
        near-duplicate of the card it replaces); then
        `pnpm cards:tombstone --id <old> --reason "…" --replaced-by <new>`. The new card
        joins this batch's second round.
   5. **Second round.** Run R1 and R2 again on every card edited or rebuilt in this
      batch. A card flagged again (any `FIX`/`REBUILD`/`DROP` you would uphold) is
      deleted with reason `failed second review: …`. There is no third round.
   6. `pnpm cards:lint --ids <the batch ids still present>`, then
      `pnpm cards:stamp --ids <every card that passed>`. `cards:stamp` refuses a card
      that fails lint (`ERR_CARDS_STAMP_REFUSED`) and stamps the rest. Deleted cards are
      gone; a card left unstamped must be listed in the report.
   7. Commit:
      `git add content && git commit -m "fix(cards): review <n> cards (<kept>/<edited>/<rebuilt>/<deleted>)"`.
5. **Report**: cards seen; kept / edited / rebuilt / deleted counts; each deletion and
   rebuild with its reason; every overruled verdict; anything left unstamped; and how
   many cards `pnpm cards:queue --count` still lists.

## Field review (`--field <name>`)

The field's spec is that skill's `references/fields/<name>.md` (**REQUIRED:**
`backfilling-card-fields`). Queue with `pnpm cards:queue --field <name>`. Run one
reviewer (R2-style, brief built from the field spec's review section) per batch; edit or
clear the field with `pnpm cards:update`; never tombstone a card over a backfilled
field. Stamp with `pnpm cards:stamp --field <name> --ids …`.

## Stop rules

- Any `pnpm cards:*` failure other than a card-level one (`ERR_CARDS_LINT`,
  `ERR_CARDS_STAMP_REFUSED`, a dropped or rejected entry): stop and report.
- Never edit `content/guides/*` or `content/*.json` lists to make a card pass. If a
  guide is wrong, say so in the report.
- Never stamp a card that was not reviewed in this run.
