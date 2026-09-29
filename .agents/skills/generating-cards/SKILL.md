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
briefing the writer, and admitting what it returns. **Does not own:** judging a card's
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

## Who does what

<!-- derived from orchestrating-models §2 -->

Two agents do the judgment, both defined in `.claude/agents/` on Sonnet 5.5 at medium
effort with only Read, Write and Bash: **`card-writer`** writes the cards and
**`card-reviewer`** reviews them (`reviewing-cards`). Spawn them by `subagent_type`, so
the model and effort come from the definition. This session runs every `pnpm cards:*`
write command and git itself, as the mechanical final step, and reads only their short
output — never the guides, and never the cards' content unless a step below says so.

Keep the agent count at one per role per run: one writer for up to 50 cards, one
reviewer for up to 50. Quality rests on the writer's self-check, lint, the
near-duplicate check in `cards:add`, and one full review. Watch the tombstone count in
`pnpm cards:stats`; if the share deleted per run climbs, tighten the review brief first.

## Procedure

1. **Branch.** Follow `reviewing-cards`'s
   [references/branch.md](../reviewing-cards/references/branch.md).
2. **New subtopic** (only with `new`). Add `{ id, ja, scene }` under the topic in
   `content/taxonomy.json`. `scene` is one or two Japanese sentences saying where the
   sentences happen. Run `pnpm -s cards:lint` to confirm the taxonomy still parses.
3. **Plan.** `pnpm -s cards:gaps <count> [range] --json > tmp/cards/plan.json`. Print
   only its totals:
   `node -e 'const p=require("./tmp/cards/plan.json");console.log(p.planned,"planned in",p.plan.length,"cells, shortfall",p.shortfall)'`.
   A shortfall above 0 means the range has too few cells; carry it into the report.
4. **Write.** Spawn one `card-writer` with: "Follow
   `.claude/skills/generating-cards/references/writer-brief.md`. Plan:
   `tmp/cards/plan.json`. Output: `tmp/cards/new.json`."
5. **Admit.** `pnpm -s cards:add tmp/cards/new.json`. It assigns ids, rejects cards that
   fail lint or sit too close to an existing card or tombstone, and prints one line per
   card admitted or dropped. Never hand-edit a dropped card back in.
6. **Top up once.** If drops left the run short, send the same writer one message
   (`SendMessage`, so its context is reused rather than a new agent started) with the
   drop lines and the missing count per cell, and output `tmp/cards/topup.json`; admit
   that. If still short, report the shortfall — never loop further.
7. **Commit.** `git add content`; if `git diff --cached --quiet` reports nothing staged,
   skip it. Otherwise `git commit -m "feat(cards): add <n> cards (<cells>)"`. Never
   `--no-verify`.
8. **Review.** Unless `--no-review`, run
   `reviewing-cards --ids <every id admitted this run>`. **REQUIRED:**
   `reviewing-cards`.
9. **Report**: cards admitted per cell, dropped count by reason, any gaps or top-up
   shortfall, the review summary, and `pnpm -s cards:stats --short | head -2`.

## Stop rules

- A `pnpm cards:*` command fails with an `ERR_*` other than a card-level one: stop and
  report it; do not patch the script or the data to get past it. Card-level, and so not
  a reason to stop: `ERR_CARDS_LINT`, `ERR_CARDS_STAMP_REFUSED`, a card `cards:add`
  dropped or `cards:update` rejected, and an `unknown id …` line.
- `ERR_CARDS_BUSY`: another write command holds `content/.cards.lock`. Run write
  commands one at a time; wait and rerun.
- The writer's file is missing or does not parse: send it one message quoting the error;
  if the file is still bad, stop and report.
- `pnpm cards:lint` reports an ERROR in a card you did not write this run: leave it for
  `reviewing-cards`, which fixes lint errors first.
- A pre-commit hook fails: fix the cause in `content/` if it is yours, otherwise stop.
