---
name: generating-cards
description: >
  Use when asked to generate, write, or add instant-composition cards (Japanese prompt,
  English model answer) under content/cards/, to fill thin topic/subtopic/level cells,
  to add a new subtopic to content/taxonomy.json, or when running /generating-cards with
  a count and an optional range such as topic=work level=5-6.
---

# Generating Cards

**Owns:** writing new cards into `content/cards/` — choosing which cells to fill,
briefing the writers, and admitting what they return. **Does not own:** judging a card's
quality or fixing one (`reviewing-cards`); filling a new field on existing cards
(`backfilling-card-fields`); changing what the `pnpm cards:*` commands check
(`writing-repo-scripts`).

Invoking this skill is the owner's authorization to **commit** on a `cards/*` branch. It
never authorizes a push, a pull request, or a merge.

## Arguments

```
/generating-cards <count> [topic=<id>[,<id>]] [subtopic=<topic>/<id>] [level=<n>|<n>-<m>] [new] [--no-review]
```

- `count` — cards to add this run. Keep it at 50 or below; a larger request is run as
  several invocations, each with its own review and commit.
- A range narrows the cells. Without one, every cell is eligible.
- `new` — only together with `subtopic=`: add that subtopic to `content/taxonomy.json`
  first. Without `new`, an unknown subtopic is an error, never an invitation to add one.
- `--no-review` — stop after writing. The cards stay unstamped, so the app never shows
  them until `reviewing-cards` runs.

## Read first

`content/guides/writing.md` is the yardstick every writer and reviewer uses. Read it
once per session. `content/levels.json`, `content/grammar.json` and
`content/taxonomy.json` are the only valid tag values.

## Procedure

1. **Branch.** Run `git status --porcelain`. If anything outside `content/` is modified,
   stop and report it. On `main`, create `cards/<YYYY-MM-DD>` (append `-2`, `-3` … if it
   exists) and switch to it. On a `cards/*` branch, stay on it. On any other branch,
   stop and report — never commit anywhere but a `cards/*` branch.
2. **New subtopic** (only with `new`). Add `{ id, ja, scene }` under the topic in
   `content/taxonomy.json`. `scene` is one or two Japanese sentences saying where the
   sentences happen. Run `pnpm cards:lint` to confirm the taxonomy still parses.
3. **Plan.** `pnpm cards:gaps <count> [range] --json` returns
   `{ plan, requested, planned, shortfall }`: the cells (`topic/subtopic × level`), how
   many cards each gets (at most 3), and 2–3 target grammar ids per cell. Do not
   second-guess the plan; it already weighs what is thin. A `shortfall` above 0 (also
   warned on stderr) means the range has too few cells; carry it into the report.
4. **Write, one writer per cell, in parallel.** Each writer is a separate sub-agent (in
   Claude Code, the `executor` agent when it is defined; otherwise a general-purpose
   sub-agent). Build the brief from
   [references/writer-brief.md](references/writer-brief.md), filling in:
   - the full text of `content/guides/writing.md`;
   - the level's entry from `content/levels.json`, including its word range;
   - the target grammar entries from `content/grammar.json`, plus the ids of every other
     grammar item valid at that level;
   - the subtopic's `ja` and `scene`;
   - `pnpm cards:show --cell <topic>/<subtopic> --level <n-1>-<n+1> --brief` (clamped to
     1–10) and `pnpm cards:show --tombstones --cell <topic>/<subtopic> --brief` —
     exactly what `cards:add` compares a new card against, so the writer can avoid it;
   - how many cards to write. Each writer returns a JSON array of cards without `id`,
     `createdAt` or `stamps`.
5. **Admit, one command at a time.** Take the JSON array out of each writer's reply:
   strip code fences and any prose around the outermost `[ … ]`. If it still does not
   parse as a JSON array, re-ask that writer once, quoting the parse error; if the
   second reply is bad too, drop the cell and report it. Save the array to
   `tmp/cards/<topic>-<subtopic>-<level>.json` (`tmp/` is gitignored scratch) and run
   `pnpm cards:add <that file>`. It assigns ids, rejects cards that fail lint or sit too
   close to an existing card or tombstone, and prints what it dropped and why (a lint
   rule, or `NEAR_DUPLICATE` with the card or tombstone it resembles). Do not hand-edit
   a dropped card back in. Writers run in parallel, but `pnpm cards:*` write commands
   (`add`, `update`, `tombstone`, `stamp`) run one at a time, never in parallel: each
   holds a lock on `content/`, and a second one fails with `ERR_CARDS_BUSY`.
6. **Top up once.** If drops left the run short, re-brief only the short cells for only
   the missing count, telling the writer why the previous ones were dropped. Admit
   again. If still short, stop and report the shortfall — never loop further.
7. **Review.** Unless `--no-review`, run `reviewing-cards` with
   `--ids <every id admitted this run>` and wait for it to finish. **REQUIRED:**
   `reviewing-cards`.
8. **Commit** (if review did not already commit everything): `git add content`; if
   `git diff --cached --quiet` reports nothing staged, skip the commit. Otherwise
   `git commit -m "feat(cards): add <n> cards (<cells>)"`. Never `--no-verify`.
9. **Report**: cards admitted per cell, dropped count by reason, cells dropped for bad
   writer output, any `gaps` or top-up shortfall, the review summary, and
   `pnpm cards:stats --short`.

## Stop rules

- Any `pnpm cards:*` command fails with an `ERR_*` other than a card-level one: stop and
  report it; do not patch the script or the data to get past it. Card-level, and so not
  a reason to stop: `ERR_CARDS_LINT`, `ERR_CARDS_STAMP_REFUSED`, a card `cards:add`
  dropped or `cards:update` rejected, and an `unknown id …` line.
- `ERR_CARDS_BUSY`: another write command is running. Wait for it and rerun; it means a
  write was started in parallel, which this skill never does.
- `pnpm cards:lint` reports an ERROR in a card you did not write this run: leave it for
  `reviewing-cards`, which fixes lint errors first.
- A pre-commit hook fails: fix the cause in `content/` if it is yours, otherwise stop.
