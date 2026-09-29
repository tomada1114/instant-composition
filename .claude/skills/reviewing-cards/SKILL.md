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
- `--field <name>`: review only that backfilled field.

## Run it as one workflow

The whole run happens inside the dynamic workflow
`.claude/workflows/reviewing-cards.js`. This session does not read the guides, run
`pnpm cards:*` or git, or judge cards — it only starts the workflow and reports what it
returns. This skill runs only in Claude Code; in a runtime without the Workflow tool,
stop and say so.

1. Turn the arguments into `args` (a JSON object, not a string):
   `{ topic?, subtopic?, level?, ids?: [..], note?, field?, limit? }`.
2. Call `Workflow({ scriptPath: ".claude/workflows/reviewing-cards.js", args })` and
   wait for its completion notice. Do nothing else meanwhile.
3. Report from the returned object: cards seen; kept / edited / rebuilt / deleted
   counts; each deletion and rebuild with its reason; every overruled verdict; rejected
   edits; batches skipped; unknown ids; lint ERRORs outside an `--ids` run; anything
   left unstamped; the commits; and `queueRemaining`. When `stop` is set, quote it and
   do not work around it.

## What the workflow does

All agents are Sonnet 5.5 at medium effort (`generating-cards`, "What the workflow
does").

1. **Prepare** — the branch step ([references/branch.md](references/branch.md)),
   `pnpm cards:lint` (without `--ids`, ERROR cards join the run first), then
   `pnpm cards:queue`: lint-ERROR cards, never-stamped cards, cards changed since their
   stamp, cards stamped under an older `perspectivesVersion`.
2. **Per batch of 15, batches in parallel:**
   1. R1, R2 and R3 in parallel, each blind to the others
      ([references/reviewer-briefs.md](references/reviewer-briefs.md)). R1 sees labels
      and `ja` only.
   2. One adjudicator decides keep / edit / rebuild / delete
      ([references/adjudication.md](references/adjudication.md)).
   3. Rebuild writers run in parallel (`generating-cards`'s
      `references/writer-brief.md`).
   4. The applier runs `cards:update`, `cards:tombstone` and `cards:add --replacing` —
      every write, across all batches, strictly one at a time, since each holds
      `content/.cards.lock`.
   5. Second round: R1–R3 on rebuilt cards, R1 and R2 on edited ones (plus R3 when the
      edit touched `topic`, `subtopic`, `level`, `grammar` or `point`). A card that
      fails again is deleted. There is no third round.
   6. `cards:lint`, `cards:stamp` on the batch's surviving cards, and a commit:
      `fix(cards): review <n> cards (<kept>/<edited>/<rebuilt>/<deleted>)`.
3. **Field review** (`--field`) — one reviewer per 20 cards applies the **Review**
   section of `backfilling-card-fields`'s `references/fields/<name>.md`; the field is
   edited or cleared with `cards:update`, never tombstoned over, and stamped with
   `cards:stamp --field`.

A batch whose reviewer or adjudicator returns nothing is skipped whole: nothing applied,
nothing stamped, and it is reported.

## Stop rules

The workflow's agents apply these and hand back `stop` instead of pressing on:

- Any `pnpm cards:*` failure other than a card-level one (`ERR_CARDS_LINT`,
  `ERR_CARDS_STAMP_REFUSED`, a card `cards:add` dropped or `cards:update` rejected, an
  `unknown id …` line). Later batches then apply nothing.
- Nobody edits `content/guides/*` or `content/*.json` lists to make a card pass; a wrong
  guide goes in the report.
- A card is never stamped unless it was reviewed in this run.
