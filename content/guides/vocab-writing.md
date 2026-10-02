# Writing a vocabulary card

The shared yardstick for whoever writes a vocabulary card (`content/vocab/`) and whoever
reviews one, as `writing.md` is for the drill's cards. A reviewer judges a card against
this file, so a rule that is not here is not a reason to reject. The lint limits quoted
below are `VOCAB_LIMITS` in `scripts/cards/vocab-rules.mjs`; that file wins when the two
disagree.

## What a card is

English to English, with the learner's first language only on the back. The front shows
the category, `definition` and `example` with its blanks; the learner recalls the
headword, flips the card, and grades themselves 忘れた, 微妙 or 覚えてた. The back shows
`headword`, the meaning in the learner's first language (`meanings.ja`), `example`
filled in with the answer in bold, and `example2`. There is no timer.

So the front alone must lead to one answer: a learner who knows the headword should
reach it from the definition and the blanks, and a learner who does not should recognize
it at once on the back.

## Categories

One schema for all four (`category`, one file each under `content/vocab/`):

- `word` 単語 — a single word: `postpone`, `reluctant`, `itinerary`.
- `idiom` 熟語 — a fixed expression whose meaning is not the sum of its words:
  `a piece of cake`, `under the weather`, `cost an arm and a leg`.
- `phrasal-verb` 句動詞 — a verb with a particle, or two: `give up`, `come up with`,
  `look forward to`.
- `phrase` 定型文 — a set phrase said as a whole turn in conversation, backchannels
  included: `no worries`, `that makes sense`, `same here`, `how's it going?`. It only
  makes sense as a reply or an opener, so its example is a dialogue.

A headword belongs in one category. Do not write the same expression again under another
one.

## `headword` — the answer

- The base form, as a learner's dictionary prints it: `give up`, not `gave up`;
  `come up with`, not `came up with`.
- 1–6 words. One line, no `{{…}}`.
- Lower case unless the word is `I` (or a contraction of it, `I'm`, `I'll`):
  `it's up to you`, `I'll keep that in mind`.
- No final period. A question keeps its `?`: `how's it going?`.
- A placeholder stands where the object varies: `one's`, `someone`, `something`
  (`make up one's mind`, `get on someone's nerves`). The example fills it in.
- Two headwords are duplicates when they are the same after normalizing (lower case,
  contractions expanded, punctuation dropped) in the same category. `cards:add` drops a
  card whose headword another card or a tombstone in its category already has.

## `definition` — the front's question

- Plain English, one sentence, at most 15 words, in words easier than the headword. A
  learner at the card's level reads it at a glance.
- It never contains the headword, nor any word that carries its meaning, in any form:
  not `postponement` for `postpone`, not `same` for `same here`, not `for a long time`
  for `long time no see`. Function words and light verbs it happens to share (`a`,
  `the`, `to`, `of`, `it`, `you`, `be`, `get`, `make`, `take`) are fine.
- It picks out the headword alone: written so that a near synonym does not answer it
  just as well. `to move an event to a later time` is `postpone`; `to change a plan` is
  half a dozen words.
- A verb starts with `to`, a noun with `a`/`an`/`the` or `something`, an adjective with
  what it describes (`feeling …`, `full of …`).
- A `phrase` says when and why it is said, not what its words mean:
  `said to show you understand and accept a reason`,
  `a polite way to say no or give bad news`.
- It needs no end punctuation, and the cards write none: a dictionary definition, not a
  sentence about one.

## `example` — the cloze

- One sentence, at most 15 words, ending with `.`, `?` or `!`. For a `phrase`, a
  two-line dialogue instead, `A: …` then `B: …` (each line at most 15 words, the `A:`
  not counted), with the phrase in the line that says it: the other line is the
  situation that makes the phrase the natural reply.
- Every blanked word is its own `{{…}}` mark. The front draws one fixed-width blank per
  mark, so the number of blanks tells the learner how many words to say:
  `She was so tired that she {{gave}} {{up}} halfway.`, never `{{gave up}}`;
  `B: {{No}} {{worries}}.`, never `{{No worries}}`. Punctuation stays outside the marks:
  `{{How's}} {{it}} {{going}}?`. A contraction is one word, one mark (`{{I'm}}`).
- The blanked words, read in order, are the headword's words in some form, matched word
  by word: an inflection (`gave` for `give`, `running` for `run`, `children` for
  `child`), and `a`/`an` or a pronoun standing for another
  (`{{It's}} {{up}} {{to}} {{me}}.` for `it's up to you`). Every headword word is
  blanked except a placeholder, which the example fills in with ordinary words outside
  the marks: `{{made}} {{up}} her {{mind}}`.
- A split phrasal verb, or an idiom that takes its object inside, keeps the object
  between its marks: `Can you {{pick}} me {{up}} at six?`,
  `That laptop {{cost}} me {{an}} {{arm}} {{and}} {{a}} {{leg}}.`.
- The sentence around the blanks is the context that makes the headword the one natural
  fill. If a more common word fits the blanks just as well, the card tests guessing, not
  recall: add the detail that rules it out, or pick another sentence.
- Everyday, current English a fluent speaker would say: work, travel, home, friends.
  Contractions are fine. American spelling. No `...` or `…`.

## `example2` — another context

- One more sentence, at most 15 words, ending with `.`, `?` or `!`, with no blanks. A
  `phrase` may use a two-line `A:`/`B:` dialogue here too.
- It shows the headword in a different situation, and where it can, in a different form
  or use (`Don't give up on your dream.` beside a past-tense `gave up`). Not the first
  example reworded.

## `meanings.ja` — the meaning on the back

- The sense `example` and `example2` use, in natural Japanese a dictionary would print:
  `延期する`, `体調がすぐれない`. Not another sense of the headword, and not a gloss of
  every sense.
- At most 20 characters, whitespace not counted. Two short glosses may be joined with
  `・` when one alone misreads (`都合がいい・便利な`); never three.
- For a `phrase`, what a Japanese speaker would say in the same turn
  (`なるほど、納得です`, `気にしないで`), not a word-for-word translation.
- One line. No romaji and no English.
- A new first language arrives as `meanings.<lang>`, filled by
  `backfilling-card-fields`; each meaning carries its own stamp.

## `level`

From `content/levels.json`, 1–10: the level whose `summary` and CEFR band a learner
would first need the headword at, to understand it and say it. Frequency and register
decide it, not length: `a piece of cake` is level 3 and `a blessing in disguise` level
7, though both are four words. Where a summary names phrasal verbs or idioms (5, 6, 7,
9, 10), it marks where they become that level's focus, not the lowest level one may sit
at: the most common ones (`give up`, `take it easy`, `no worries`) are everyday English
from level 3, and a rare or subtle one belongs at 8–10 whatever its category. The
definition and examples stay readable at the card's level, whatever the headword's.

## Within one batch for one cell

- Every headword is different, and none is a variant of another card's (`give up` and
  `give up on`; `take it easy` and `take things easy`).
- Vary the situations of the examples, and their subjects and tenses.
- Nothing whose headword sits in an existing card or a tombstone of the category (you
  are given both).

## Things never to write

As `writing.md`'s list: nothing a learner would feel awkward saying aloud on a train, no
real people's names in a way that says something about them, brand names only where the
scene needs one, and no facts that go stale. An idiom with a slur or a crude image in it
is left out, however common.
