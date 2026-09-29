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

- `count` — cards to add this run, at most 50. A larger request is run as several
  invocations, one after another, each with its own review and commits.
- A range narrows the cells. Without one, every cell is eligible.
- `new` — only together with `subtopic=`: add that subtopic to `content/taxonomy.json`
  first. Without `new`, an unknown subtopic is an error, never an invitation to add one.
- `--no-review` — stop after writing. The cards stay unstamped, so the app never shows
  them until `reviewing-cards` runs.

## Run it as one workflow

The whole run happens inside the dynamic workflow
`.claude/workflows/generating-cards.js`. This session does not read the guides, plan,
brief writers, run `pnpm cards:*` or git, or judge cards — it only starts the workflow
and reports what it returns. This skill runs only in Claude Code; in a runtime without
the Workflow tool, stop and say so.

1. Turn the arguments into `args` (a JSON object, not a string):
   `{ count, topic?, subtopic?, level?, isNew?, noReview? }` — `topic` and `level` as
   written (`"work,travel"`, `"5-6"`), `subtopic` as `"<topic>/<id>"`.
2. Call `Workflow({ scriptPath: ".claude/workflows/generating-cards.js", args })` and
   wait for its completion notice. Do nothing else meanwhile.
3. Report from the returned object: cards admitted per cell, drop reasons, cells whose
   writer failed, the gaps and top-up shortfalls, the commit, the review summary, any
   `stop`, and `stats`. When `stop` is set, quote it and do not work around it.

## What the workflow does

All agents are Sonnet 5.5 at medium effort. Quality rests on the pipeline, not on one
model: lint, the near-duplicate check, three independent reviewers, and a second round
that deletes whatever fails again. Watch the tombstone count in `pnpm cards:stats`; if
the share deleted per run climbs, raise R2 first, since it judges naturalness.

1. **Prepare** — the branch step (`reviewing-cards`'s `references/branch.md`), the new
   subtopic when `new`, then `pnpm cards:gaps <count> [range] --json`: the cells, how
   many cards each gets (at most 3), and 2–3 target grammar ids per cell.
2. **Write** — one writer per cell, in parallel, each following
   [references/writer-brief.md](references/writer-brief.md) and writing
   `tmp/cards/<topic>-<subtopic>-<level>.json`.
3. **Admit** — `pnpm cards:add <file>` per cell as each writer finishes, strictly one at
   a time: every write command holds `content/.cards.lock`, and a second one fails with
   `ERR_CARDS_BUSY`. A cell left short gets one top-up writer for the missing count,
   told why the previous cards were dropped; never a second.
4. **Commit** the admitted cards: `feat(cards): add <n> cards (<cells>)`.
5. **Review** — unless `--no-review`, the `reviewing-cards` workflow runs as a child on
   every admitted id and commits its own fixes.

## Stop rules

The workflow's agents apply these and hand back `stop` instead of pressing on:

- A `pnpm cards:*` command fails with an `ERR_*` other than a card-level one
  (card-level: `ERR_CARDS_LINT`, `ERR_CARDS_STAMP_REFUSED`, a card `cards:add` dropped
  or `cards:update` rejected, an `unknown id …` line). Nobody patches the script or the
  data to get past it.
- A pre-commit hook fails on something outside what the run wrote.
- `pnpm cards:lint` ERRORs in cards this run did not write are left for
  `reviewing-cards`, which fixes lint errors first.
