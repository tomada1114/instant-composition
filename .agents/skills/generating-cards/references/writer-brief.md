# Writer brief

A writer is one agent in the generating-cards or reviewing-cards workflow. The
workflow's prompt names the cell (`topic/subtopic`), the level, the target grammar ids,
how many cards to write, and the file to write them to; a rebuild or a top-up adds the
old card or the reasons earlier ones were dropped. Everything else you gather yourself.
Run no `pnpm cards:*` write command — the workflow admits the file.

## Gather

- `content/guides/writing.md` — the writing rules. Follow every one.
- The level's entry in `content/levels.json`: its `summary`, `toeic`, `cefr`, `words`
  range and `jaChars.max`.
- The target grammar entries in `content/grammar.json`, and the ids of every other
  grammar item valid at that level.
- The subtopic's `ja` and `scene` in `content/taxonomy.json`.
- `pnpm -s cards:show --cell <topic>/<subtopic> --level <n-1>-<n+1> --brief` (clamped to
  1–10): already in the cell — write nothing close to these.
- `pnpm -s cards:show --tombstones --cell <topic>/<subtopic> --brief`: deleted from the
  cell before — do not recreate these.

Those two lists are exactly what `cards:add` compares a new card against, so a card
close to one of them is dropped as `NEAR_DUPLICATE`.

## Write

The cards are for an instant English composition drill for Japanese learners. The
learner sees the Japanese sentence (`ja`), says the English aloud before a timer runs
out, then flips the card and grades themselves against the model answer (`en`) and the
alternatives.

- `en` has the level's `words` range, every alternative at most `words.max` words, and
  `ja` at most `jaChars.max` characters (whitespace not counted).
- Those caps are ceilings, not targets: write each sentence as short as its scene
  allows. Make the card harder through what the level summary names — vocabulary, idioms
  and phrasal verbs, structure — never through a longer sentence.
- Spread the target grammar across the cards; every card uses at least one of it. Other
  grammar ids valid at the level may appear only as a second tag.

## Output

Write a JSON array to the file the workflow named, one element per card, without `id`,
`createdAt` or `stamps`:

```json
{
  "ja": "…",
  "en": "…",
  "alternatives": ["…", "…"],
  "point": "…",
  "topic": "<topic id>",
  "subtopic": "<subtopic id>",
  "level": 5,
  "grammar": ["…"]
}
```

Before writing it, check each card: the word count of `en` is inside the range; each
alternative is within `words.max`; `ja` is within `jaChars.max`; no word or clause could
go without losing the card's point; 2 or 3 alternatives, none a mere contraction or
punctuation variant of `en`; `grammar` has 1–2 ids from the lists above; `ja` pins the
subject, tense, polarity and politeness of the English. Then confirm the file parses
with `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' <file>`.
