# Vocabulary review brief

The `card-reviewer` agent follows this for vocabulary cards (`kind=vocab`). One reviewer
checks every perspective and decides every card itself; nothing re-reviews its work, so
decide carefully and fix what you can. The prompt names the batch (`<b>`, `1` unless the
run was split) and, when the owner passed one, a `--note` to check specifically.

## Input

`tmp/cards/queue-<b>.json` — the `pnpm cards:queue --kind vocab --json` entries
`{ reason, errors, card }`; `errors` holds the card's lint findings.

## 1. Blind recall first

Before you open anything else, print only each card's front — position, category, level,
definition, and the example with each `{{…}}` mark as `____`:

```sh
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).forEach((q,i)=>console.log(i,q.card.category,q.card.level,"|",q.card.definition,"|",q.card.example.replace(/\{\{[^{}]*\}\}/g,"____").replace(/\n/g," / ")))' tmp/cards/queue-<b>.json
```

For each front, write the 1–3 answers a learner who knows English well would put in the
blanks, the most likely first (`vocab-review-perspectives.md`, V1). Write them to
`tmp/cards/review-<b>-blind.json` as `[{ "index": …, "answers": [...] }]` before you
look at any `headword`: this is the check that the front pins one answer.

## 2. Gather — two tool calls

1. One `cat` of `queue-<b>.json`, `content/guides/vocab-writing.md`,
   `content/guides/vocab-review-perspectives.md`, `content/guides/identity.md` and
   `content/levels.json`.
2. One Bash call running `pnpm -s cards:dupes --kind vocab --ids <every id> --json` and,
   for every category in the batch,
   `pnpm -s cards:show --kind vocab category=<category> --brief`.

## 3. Judge every card

Apply every check in `vocab-review-perspectives.md` (V1–V5) and fix the lint findings in
`errors`:

- **V1.** Compare your blind answers with `headword`. Another answer first, fitting as
  well, means the definition or the sentence does not pin the headword: name which.
- **V2.** A definition holding the headword, or a word that carries its meaning, is a
  `FIX` however good the rest is. A blank that a more common word fills as naturally is
  a `FIX` when a detail rules it out, a rebuild when only another sentence would. A
  multi-word mark (`{{gave up}}`) is split into one mark per word.
- **V3.** "Correct but nobody says it now" is a failure, in the examples and in the
  headword itself.
- **V4.** Read each meaning against both examples, not against the headword alone.
- **V5.** Treat the `cards:dupes` pairs as certain and the category's headwords as leads
  for variants and the same expression in another category.
- Think each card through before deciding.

Decide each card, using `identity.md`'s "A vocabulary card" for edit vs. rebuild:

- **keep** — nothing to change.
- **edit** — the fix keeps the question: the same headword in the same sense. Every
  edited card must pass every check after the edit; `cards:update --kind vocab` rejects
  one that fails lint.
- **rebuild** — a repair would change the question. Write the replacement yourself, in
  the same category, following
  `.claude/skills/generating-cards/references/vocab-writer-brief.md`'s **Write** rules.
- **delete** — not worth keeping, or you could not make it pass.

## 4. Output — always write all four files, `[]` when empty

- `tmp/cards/review-<b>-edits.json` — `[{ "id": …, <changed core fields> }]`, each field
  with its full new value. A meaning goes as `"meanings": { "ja": "…" }`, merged by
  language into the card's meanings. This is the `pnpm cards:update --kind vocab` input.
- `tmp/cards/review-<b>-deletes.json` — `[{ "id": …, "reason": "<one line>" }]`.
- `tmp/cards/review-<b>-rebuilds.json` —
  `[{ "old": …, "reason": "<one line>", "card": { <a new card without id, createdAt or stamps> } }]`.
- `tmp/cards/review-<b>-summary.json` —
  `{ "kept": [ids], "guideIssues": ["<a guide that looks wrong, and why>"] }`.

Confirm each file parses with `node -e 'JSON.parse(…)'`. Never edit `content/` yourself.

## Meaning review

When the prompt names a field `meanings.<lang>` instead, the input holds cards with that
meaning and there is no blind step. Read the **Review** section of
`.claude/skills/backfilling-card-fields/references/fields/meanings.<lang>.md`, with
`content/guides/vocab-writing.md` as background, and write only
`tmp/cards/review-<b>-edits.json`:
`[{ "id": …, "meanings": { "<lang>": <corrected> } }]` for a meaning to fix,
`"<lang>": null` to clear one that cannot be fixed. Never touch another field, and never
delete or rebuild a card over a meaning.
