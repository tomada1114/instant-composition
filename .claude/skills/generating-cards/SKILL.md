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
   stop and report it. If the current branch is `main`, create `cards/<YYYY-MM-DD>`
   (append `-2`, `-3` … if it exists) and switch to it. Any other `cards/*` branch is
   fine to keep using.
2. **New subtopic** (only with `new`). Add `{ id, ja, scene }` under the topic in
   `content/taxonomy.json`. `scene` is one or two Japanese sentences saying where the
   sentences happen. Run `pnpm cards:lint` to confirm the taxonomy still parses.
3. **Plan.** `pnpm cards:gaps <count> [range] --json`. It returns cells
   (`topic/subtopic × level`), how many cards each gets (at most 5), and 2–3 target
   grammar ids per cell. Do not second-guess the plan; it already weighs what is thin.
4. **Write, one writer per cell, in parallel.** Each writer is a separate sub-agent (in
   Claude Code, the `executor` agent when it is defined; otherwise a general-purpose
   sub-agent). Build the brief from
   [references/writer-brief.md](references/writer-brief.md), filling in:
   - the full text of `content/guides/writing.md`;
   - the level's entry from `content/levels.json`, including its word range;
   - the target grammar entries from `content/grammar.json`, plus the ids of every other
     grammar item valid at that level;
   - the subtopic's `ja` and `scene`;
   - `pnpm cards:show --cell <topic>/<subtopic> --level <n> --brief` (existing `ja`/`en`
     in that cell) and `pnpm cards:show --tombstones --cell <topic>/<subtopic> --brief`;
   - how many cards to write. Each writer returns a JSON array of cards without `id`,
     `createdAt` or `stamps`.
5. **Admit.** Save each writer's array to `tmp/cards/<topic>-<subtopic>-<level>.json`
   (`tmp/` is gitignored scratch) and run `pnpm cards:add <that file>`. It assigns ids,
   rejects cards that fail lint or sit too close to an existing card or tombstone, and
   prints what it dropped and why (a lint rule, or `NEAR_DUPLICATE` with the card or
   tombstone it resembles). Do not hand-edit a dropped card back in.
6. **Top up once.** If drops left the run short, re-brief only the short cells for only
   the missing count, telling the writer why the previous ones were dropped. Admit
   again. If still short, stop and report the shortfall — never loop further.
7. **Review.** Unless `--no-review`, run `reviewing-cards` with
   `--ids <every id admitted this run>` and wait for it to finish. **REQUIRED:**
   `reviewing-cards`.
8. **Commit** (if review did not already commit everything):
   `git add content && git commit -m "feat(cards): add <n> cards (<cells>)"`. Never
   `--no-verify`.
9. **Report**: cards admitted per cell, dropped count by reason, the review summary, and
   `pnpm cards:stats --short`.

## Stop rules

- Any `pnpm cards:*` command fails with an `ERR_*` other than a card-level one
  (`ERR_CARDS_LINT`, or a card `cards:add` dropped): stop and report it; do not patch
  the script or the data to get past it.
- `pnpm cards:lint` reports an ERROR in a card you did not write this run: leave it for
  `reviewing-cards`, which fixes lint errors first.
- A pre-commit hook fails: fix the cause in `content/` if it is yours, otherwise stop.
