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
- `--ids` reviews exactly those cards, stamped or not. `--note` passes the owner's
  observation to the reviewer, to check specifically.
- `--field <name>`: review only that backfilled field.

## Who does what

One `card-reviewer` agent (Sonnet 5.5, medium effort; `generating-cards`, "Who does
what") reviews up to 50 cards against every perspective, decides each card, writes any
rebuild itself, and hands back JSON files. It follows
[references/review-brief.md](references/review-brief.md). Nothing re-reviews its work:
one reviewer and one pass, with lint as the mechanical final check. This session runs
the commands and git, and reads the reviewer's files only as far as applying them needs.

## Procedure

1. **Branch.** Follow [references/branch.md](references/branch.md).
2. **Lint.** `pnpm -s cards:lint | tail -1`. Without `--ids`, ERROR cards are queued
   first. With `--ids`, only those cards are reviewed: note how many other cards have
   ERRORs for the report.
3. **Queue.**
   `pnpm -s cards:queue [range] [--ids …] [--field <name>] --limit <n> --json > tmp/cards/queue.json`
   (`--limit` defaults to 50; an `unknown id …` line on stderr goes in the report).
   Split it into batches of at most 50:
   `node -e 'const q=require("./tmp/cards/queue.json");for(let b=0;b*50<q.length;b++)require("fs").writeFileSync("tmp/cards/queue-"+(b+1)+".json",JSON.stringify(q.slice(b*50,b*50+50)));console.log(q.length)'`.
   Nothing queued: report that and stop.
4. **Review.** Spawn one `card-reviewer` per batch, in parallel when there is more than
   one: "Follow `.claude/skills/reviewing-cards/references/review-brief.md` for batch
   `<b>`." Add `Field: <name>` with `--field`, and `Note: <text>` with `--note`.
5. **Apply**, per batch, one `pnpm cards:*` write command at a time:
   - `pnpm -s cards:update tmp/cards/review-<b>-edits.json` when it is not `[]`.
   - Each entry of `review-<b>-deletes.json`:
     `pnpm -s cards:tombstone --id <id> --reason "<reason>"`.
   - Each entry of `review-<b>-rebuilds.json`: write `[<card>]` to
     `tmp/cards/rebuild-<old>.json`, run
     `pnpm -s cards:add tmp/cards/rebuild-<old>.json --replacing <old>`, then
     `pnpm -s cards:tombstone --id <old> --reason "<reason>" --replaced-by <new id>`. If
     `cards:add` drops it, tombstone the old card with reason
     `rebuild failed: <the drop reason>`.
6. **Final check and stamp.** The reviewed cards still present are every queued id not
   deleted or replaced, plus each new rebuilt id. `pnpm -s cards:lint --ids <them>`,
   then `pnpm -s cards:stamp --ids <them>` (with `--field <name>` for a field review).
   `cards:stamp` refuses a card that fails lint (`ERR_CARDS_STAMP_REFUSED`) and stamps
   the rest; a refused card stays unstamped and goes in the report.
7. **Commit.** `git add content`; if `git diff --cached --quiet` reports nothing staged,
   skip it. Otherwise
   `git commit -m "fix(cards): review <n> cards (<kept>/<edited>/<rebuilt>/<deleted>)"`
   (for a field: `fix(cards): review <name> on <n> cards`). Never `--no-verify`.
8. **Report**: cards seen; kept / edited / rebuilt / deleted counts; each deletion and
   rebuild with its reason; rejected edits; failed rebuilds; unknown ids; lint ERRORs
   outside an `--ids` run; anything left unstamped; `guideIssues` from the summary
   files; and `pnpm -s cards:queue --count`.

## Stop rules

- Any `pnpm cards:*` failure other than a card-level one: stop and report. Card-level,
  and so not a reason to stop: `ERR_CARDS_LINT`, `ERR_CARDS_STAMP_REFUSED`, a card
  `cards:add` dropped or `cards:update` rejected, and an `unknown id …` line.
- `ERR_CARDS_BUSY`: another write command holds `content/.cards.lock`. Run write
  commands one at a time; wait and rerun.
- A reviewer's file is missing or does not parse: send it one message quoting the error;
  if it is still bad, apply nothing and stamp nothing for that batch, and report it.
- Never edit `content/guides/*` or `content/*.json` lists to make a card pass. If a
  guide is wrong, say so in the report.
- Never stamp a card that was not reviewed in this run.
