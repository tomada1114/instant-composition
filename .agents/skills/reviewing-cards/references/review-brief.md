# Review brief

The `card-reviewer` agent follows this. One reviewer checks every perspective and
decides every card itself; nothing re-reviews its work, so decide carefully and fix what
you can. The prompt names the batch (`<b>`, `1` unless the run was split) and, when the
owner passed one, a `--note` to check specifically.

## Input

`tmp/cards/queue-<b>.json` — the `pnpm cards:queue --json` entries
`{ reason, errors, card }`; `errors` holds the card's lint findings.

## 1. Blind composition first

Before you open anything else, print only each card's position, `ja` and `level`:

```sh
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).forEach((q,i)=>console.log(i,q.card.level,q.card.ja))' tmp/cards/queue-<b>.json
```

Read the `summary` and `words` range of each level in `content/levels.json`, and for
each `ja` write 1–3 English sentences a fluent speaker would naturally say there, most
likely first, as short as the situation allows. Write them to
`tmp/cards/review-<b>-blind.json` as `[{ "index": …, "sentences": [...] }]` before you
look at any `en`: this is the check that `ja` pins one answer.

## 2. Gather — two tool calls

1. One `cat` of `queue-<b>.json`, `content/guides/writing.md`,
   `content/guides/identity.md`, `content/guides/review-perspectives.md`,
   `content/grammar.json` and `content/taxonomy.json`.
2. One Bash call running `pnpm -s cards:dupes --ids <every id> --json` and, for every
   cell in the batch, `pnpm -s cards:show --cell <topic>/<subtopic> --brief`.

## 3. Judge every card

Apply every check in `review-perspectives.md` (R1–R3) and fix the lint findings in
`errors`:

- **R1.** Compare your blind sentences' skeleton with `en`. A different skeleton means
  `ja` does not pin the English: fix `ja`, or add an alternative when the other skeleton
  is also right. A natural, likely, same-skeleton answer missing from `alternatives` is
  worth adding; keep 2–3.
- **R2.** "Grammatical but a native speaker would not say it" is a failure. `en` and
  each alternative stay within the level's `words` range and `ja` within `jaChars.max`;
  a sentence that could lose words without losing its point gets shortened — the level's
  difficulty comes from vocabulary, idiom and structure, never from length.
- **R3.** Judge the level by structure, vocabulary and idiom, not length. Treat the
  `cards:dupes` candidates as a lead and judge sameness against every card in the cell.
- Think each card through before deciding.

Decide each card, using `identity.md` for edit vs. rebuild:

- **keep** — nothing to change.
- **edit** — the fix keeps the question. Every edited card must pass every check after
  the edit.
- **rebuild** — a repair would change the question. Write the replacement yourself, in
  the same cell, following
  `.claude/skills/generating-cards/references/writer-brief.md`'s **Write** rules; it
  must not be close to any card in the cell.
- **delete** — not worth keeping, or you could not make it pass.

## 4. Output — always write all four files, `[]` when empty

- `tmp/cards/review-<b>-edits.json` — `[{ "id": …, <changed core fields> }]`, each field
  with its full new value (`alternatives` as the whole array). This is the
  `pnpm cards:update` input.
- `tmp/cards/review-<b>-deletes.json` — `[{ "id": …, "reason": "<one line>" }]`.
- `tmp/cards/review-<b>-rebuilds.json` —
  `[{ "old": …, "reason": "<one line>", "card": { <a new card without id, createdAt or stamps> } }]`.
- `tmp/cards/review-<b>-summary.json` —
  `{ "kept": [ids], "guideIssues": ["<a guide that looks wrong, and why>"] }`.

Confirm each file parses with `node -e 'JSON.parse(…)'`. Never edit `content/` yourself.

## Field review

When the prompt names a field instead, the input holds cards with that field and there
is no blind step. Read the **Review** section of
`.claude/skills/backfilling-card-fields/references/fields/<name>.md`, with
`content/guides/writing.md` as background, and write only
`tmp/cards/review-<b>-edits.json`: `[{ "id": …, "<name>": <corrected value> }]` for a
value to fix, `"<name>": null` to clear one that cannot be fixed. Never delete or
rebuild a card over a backfilled field.
