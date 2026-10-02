# Vocabulary writer brief

The `card-writer` agent follows this for vocabulary cards (`kind=vocab`). The prompt
names the plan file (default `tmp/cards/plan.json`, the
`pnpm cards:gaps --kind vocab --json` output: `plan[]` of `{ category, level, count }`)
and the output file (default `tmp/cards/new.json`). A top-up prompt adds the cards that
were dropped and why.

## Gather — two tool calls

1. One `cat` of `content/guides/vocab-writing.md`, `content/levels.json` and the plan
   file.
2. One Bash call that, for every category in the plan, runs
   `pnpm -s cards:show --kind vocab category=<category> --brief` and
   `pnpm -s cards:show --kind vocab --tombstones category=<category> --brief`. Each line
   is `<headword> (<category>)`. A duplicate is the same headword anywhere in the
   category, at any level, so read the whole category: write no headword these lists
   hold, or `cards:add` drops it as `DUPLICATE`.

## Write

The cards are for an English-to-English vocabulary activity for Japanese learners. The
learner sees the category, the definition and the example with its blanks, recalls the
headword, then flips the card and grades themselves against the headword, the Japanese
meaning and the filled-in examples. Follow every rule in `vocab-writing.md`.

For each cell, write `count` cards in its category at its level:

- Pick headwords a learner at that level would meet next, by the level's `summary` in
  `levels.json`, and that are not in the lists you gathered.
- Write the definition before the example, without the headword or any word that carries
  its meaning, and check it picks out the headword alone.
- Blank every headword word with its own `{{…}}` mark — `{{gave}} {{up}}`, never
  `{{gave up}}` — and give the sentence the detail that rules out a more common word.
- For `phrase`, `example` is a two-line dialogue, `A: …` then `B: …`, with the phrase
  blanked in the line that says it.

## Output

One JSON array covering every cell, written to the output file, one element per card,
without `id`, `createdAt` or `stamps`:

```json
{
  "category": "phrasal-verb",
  "level": 3,
  "headword": "give up",
  "definition": "to stop trying to do something because it is too hard",
  "example": "She was so tired that she {{gave}} {{up}} halfway.",
  "example2": "Don't give up; you're almost there.",
  "meanings": { "ja": "あきらめる" }
}
```

A dialogue's two lines are one JSON string joined by `\n`:
`"A: Sorry, I forgot to call you back.\nB: {{No}} {{worries}}."`.

Before writing it, check each card: the headword is the base form, lower case unless
`I`, with no final period; the definition is one sentence of at most 15 words and holds
no word of the answer; each example line is at most 15 words and ends with `.`, `?` or
`!`; the blanked words, in order, are the headword's words; `example2` has no blank and
another context; `meanings.ja` is at most 20 characters and matches the examples' sense.

Then write the file and run `pnpm -s cards:add --kind vocab <file> --dry-run`. It writes
nothing; it prints a `dropped` line for every card that fails lint or repeats a
headword. Rewrite every card it names and run it again, until it prints none.
