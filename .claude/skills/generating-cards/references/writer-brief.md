# Writer brief

The `card-writer` agent follows this. The prompt names the plan file (default
`tmp/cards/plan.json`, the `pnpm cards:gaps --json` output: `plan[]` of
`{ topic, subtopic, level, count, targetGrammar }`) and the output file (default
`tmp/cards/new.json`). A top-up prompt adds the cards that were dropped and why.

## Gather — two tool calls

1. One `cat` of `content/guides/writing.md`, `content/levels.json`,
   `content/grammar.json`, `content/taxonomy.json` and the plan file.
2. One Bash call that, for every cell in the plan, runs
   `pnpm -s cards:show --cell <topic>/<subtopic> --level <n-1>-<n+1> --brief` (clamped
   to 1–10) and `pnpm -s cards:show --tombstones --cell <topic>/<subtopic> --brief`.
   These are exactly what `cards:add` compares a new card against: write nothing close
   to an existing card, and never recreate a tombstoned one, or it is dropped as
   `NEAR_DUPLICATE`.

## Write

The cards are for an instant English composition drill for Japanese learners. The
learner sees the Japanese sentence (`ja`), says the English aloud before a timer runs
out, then flips the card and grades themselves against the model answer (`en`) and the
alternatives. Follow every rule in `writing.md`.

For each cell, write `count` cards set in the subtopic's `scene`:

- Keep `en` at `words.target` words or fewer and `ja` at `jaChars.target` characters or
  fewer (whitespace not counted), raised by the `targetAllowance` of a grammar id the
  card is tagged with, as `writing.md`'s "Short at every level" explains. The targets
  are the limit you write to; `words.max` and `jaChars.max` are only the lint's hard
  ceilings, never something to fill. `en` must still reach `words.min`, and every
  alternative stays at most `words.max`.
- At levels 8–10, give every card the element that makes it that level — an idiom, an
  implication, a precise word, inversion — as the `level` entry under `writing.md`'s
  "Tags" shows. A reviewer moves a card whose hardest element is plain down to the level
  that element belongs to, so a high grammar tag written plainly does not fill a high
  cell.
- One sentence, one idea: a core plus at most one added detail, no two statements joined
  by `and`/`but`/`so`, as `writing.md`'s "One sentence, one idea" sets out. A learner
  should say it in one breath and want to say the next one.
- Make the card harder through what the level summary names — vocabulary, idioms and
  phrasal verbs, structure — never through a longer sentence.
- Spread the cell's `targetGrammar` across its cards; every card uses at least one of
  them. Other grammar ids valid at the level may appear only as a second tag.

## Output

One JSON array covering every cell, written to the output file, one element per card,
without `id`, `createdAt` or `stamps`:

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

Before writing it, check each card: every sentence is one sentence with at most one
added detail; no word or clause could go without losing the card's point; 2 or 3
alternatives, none a mere contraction or punctuation variant of `en`; `grammar` has 1–2
valid ids; `ja` pins the subject, tense, polarity and politeness of the English.

Then write the file and run `pnpm -s cards:add <file> --dry-run`. It writes nothing; it
prints what `cards:add` would do — a `dropped` line for a card failing lint or too close
to another, and a `WARN … OVER_TARGET` line for a card over a target. Rewrite every card
it names and run it again, until it prints neither. A card may stay over a target only
when every shorter natural sentence loses its point; name each such card and why in your
final message.
