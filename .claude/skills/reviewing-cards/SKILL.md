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

1. **Branch.** Run `git status --porcelain`. If anything outside `content/` is modified,
   stop and report it. On `main`, create `cards/<YYYY-MM-DD>` (append `-2`, `-3` … if it
   exists) and switch to it. On a `cards/*` branch, stay on it. On any other branch,
   stop and report — never commit anywhere but a `cards/*` branch.
2. **Lint.** `pnpm cards:lint`. Without `--ids`, ERROR cards join this run first. With
   `--ids`, only those cards are reviewed: note how many other cards have ERRORs for the
   report, but do not pull them in.
3. **Queue.** `pnpm cards:queue [range] [--ids …] --limit <n> --json` returns, in order:
   lint-ERROR cards, never-stamped cards, cards changed since their stamp, cards stamped
   under an older `perspectivesVersion` — each as `{ reason, errors, card }`, with the
   lint findings in `errors`. With `--ids`, every listed card is returned, current ones
   last; an id that is not a card is reported as `unknown id …` on stderr — list it in
   the report and go on.
4. **Batch** the queue into groups of 10–20 cards. For each batch:
   1. `pnpm cards:dupes --ids <batch ids> --json` for R3's near-duplicate candidates,
      and `pnpm cards:show --cell <topic>/<subtopic> --brief` for every cell in the
      batch, so R3 can judge sameness against the whole cell.
   2. Run **R1, R2 and R3 in parallel**, each a separate sub-agent that did not write
      these cards and never sees another reviewer's output. Briefs are in
      [references/reviewer-briefs.md](references/reviewer-briefs.md). R1 sees labels
      (`b1`, `b2`, …) instead of card ids; keep the label → id map yourself and map its
      answer back. In Claude Code, R1 uses the `executor` agent and R2/R3 the
      `architect` agent when those are defined; otherwise general-purpose sub-agents.
   3. **Read the replies.** Take the JSON array out of each reply: strip code fences and
      any prose around the outermost `[ … ]`. If it still does not parse, re-ask that
      reviewer once, quoting the parse error. If the second reply is bad too, skip the
      batch: apply nothing, stamp nothing, and report it.
   4. **Adjudicate** every card yourself — keep, edit, rebuild, or delete — using
      `identity.md` for edit vs. rebuild. For R1, compare each blind sentence's skeleton
      with `en`: a different skeleton means fix `ja` or add an alternative; a natural,
      likely same-skeleton answer missing from `alternatives` is worth adding (keep
      2–3). A `low`-confidence finding with no second reviewer agreeing may be
      dismissed. Record every overruled `REBUILD`/`DROP` with a one-line reason.
   5. **Apply**, one `pnpm cards:*` write command at a time — never in parallel: each
      holds a lock on `content/`, and a second one fails with `ERR_CARDS_BUSY`.
      - Edit in place: write `[{ "id": …, <changed fields> }]` to
        `tmp/cards/edits.json`, then `pnpm cards:update tmp/cards/edits.json`.
      - Delete: `pnpm cards:tombstone --id <id> --reason "<one line>"`.
      - Rebuild: brief one writer with the writer brief (**REQUIRED:**
        `generating-cards`, its `references/writer-brief.md`) for 1 card in the same
        cell, adding the reviewers' findings and the old card;
        `pnpm cards:add <file> --replacing <old>` (so the rebuild is not dropped as a
        near-duplicate of the card it replaces); then
        `pnpm cards:tombstone --id <old> --reason "…" --replaced-by <new>`. The new card
        joins this batch's second round. If `cards:add` drops the new card, delete the
        old one with reason `rebuild failed: <the drop reason>` and report it.
   6. **Second round.** Run R1, R2 and R3 again on every rebuilt card, and R1 and R2 on
      every edited card — plus R3 when the edit changed `topic`, `subtopic`, `level`,
      `grammar` or `point`. A card flagged again (any `FIX`/`REBUILD`/`DROP` you would
      uphold) is deleted with reason `failed second review: …`. There is no third round.
   7. `pnpm cards:lint --ids <the batch ids still present>`, then
      `pnpm cards:stamp --ids <every card that passed>`. `cards:stamp` refuses a card
      that fails lint or is not a card (`ERR_CARDS_STAMP_REFUSED`) and stamps the rest.
      Deleted cards are gone; a card left unstamped must be listed in the report.
   8. **Commit.** `git add content`; if `git diff --cached --quiet` reports nothing
      staged, skip the commit. Otherwise
      `git commit -m "fix(cards): review <n> cards (<kept>/<edited>/<rebuilt>/<deleted>)"`.
5. **Report**: cards seen; kept / edited / rebuilt / deleted counts; each deletion and
   rebuild with its reason; every overruled verdict; batches skipped for bad reviewer
   output; unknown ids; lint ERRORs outside an `--ids` run; anything left unstamped; and
   how many cards `pnpm cards:queue --count` still lists.

## Field review (`--field <name>`)

The field's spec is that skill's `references/fields/<name>.md` (**REQUIRED:**
`backfilling-card-fields`). Queue with `pnpm cards:queue --field <name>`. Run one
reviewer (R2-style, brief built from the field spec's review section) per batch, reading
its reply as in step 4.3; edit or clear the field with `pnpm cards:update`; never
tombstone a card over a backfilled field. Stamp with
`pnpm cards:stamp --field <name> --ids …`, and commit as in step 4.8.

## Stop rules

- Any `pnpm cards:*` failure other than a card-level one: stop and report. Card-level,
  and so not a reason to stop: `ERR_CARDS_LINT`, `ERR_CARDS_STAMP_REFUSED`, a card
  `cards:add` dropped or `cards:update` rejected, and an `unknown id …` line.
- `ERR_CARDS_BUSY`: another write command is running. Wait for it and rerun; it means a
  write was started in parallel, which this skill never does.
- Never edit `content/guides/*` or `content/*.json` lists to make a card pass. If a
  guide is wrong, say so in the report.
- Never stamp a card that was not reviewed in this run.
