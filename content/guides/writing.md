# Writing a card

The shared yardstick for whoever writes a card and whoever reviews one. A reviewer
judges a card against this file, so a rule that is not here is not a reason to reject.

## What a card is

The learner sees `ja`, says the English aloud before a timer runs out, flips the card,
and marks themselves right or wrong. The timer is derived from the length of `en`. The
back shows `en` (the model answer), `alternatives` (2–3 other answers that are just as
right) and `point` (the one thing worth noticing).

Everything below follows from that: the learner has only the Japanese to go on, has a
few seconds, and grades themselves by comparing against the back.

## Short at every level

Instant composition trains producing a sentence at once. A longer sentence is slower to
produce, not harder in a way that trains that, so difficulty comes from vocabulary,
idioms and phrasal verbs, and structure — never from length. Every level in
`content/levels.json` caps length, and the caps stay close together from level 1 to
level 10:

- `en` sits inside the level's `words` range, and every alternative stays at or under
  its `words.max`.
- `ja` stays at or under the level's `jaChars.max` characters. Whitespace does not
  count; punctuation does.

The lint rejects a card over any of these. The cap is a ceiling, not a target: a
sentence is as short as its scene allows. If a word or a clause can go without losing
the point of the card, it goes.

## `ja` — the front

- **Natural Japanese a person would actually say or write** in the scene, not
  translationese. 「明日の会議、10 分遅れて始めてもいいですか？」,
  not「明日の会議を 10 分遅く始めることは大丈夫ですか？」.
- **It must pin down the skeleton of the English**: who the subject is, the tense and
  aspect, positive or negative, question or statement, request or suggestion, and the
  politeness level. If two learners could read the Japanese and produce English with
  different skeletons, both right, the learner cannot grade themselves — that is the
  single most important failure to avoid. Put the cue in natural Japanese: 「もう」 for
  a completed action, 「〜したことある？」 for experience, 「〜してもらえますか」 for a
  polite request, an explicit subject when Japanese would normally drop an ambiguous
  one.
- **Give the situation in the sentence itself**, not in a stage direction. A sentence
  with a concrete who/what/when is easier to remember and closer to real use than a
  textbook sentence with no context — the most common complaint about existing
  composition books.
- One sentence. Two short sentences only when the second is what makes the scene
  (「傘持ってる？雨が降りそう。」), and only within the level's `jaChars.max`.
- Plain punctuation: 、。？！. No 「…」 and no romaji.
- Latin letters only for proper nouns, product names, acronyms and units, written the
  way a Japanese writer
  would: 「Slack で送って」, 「iPhone」, 「OK です」, 「PR を出す」,「Tシャツ」, 「5km」.
  Never an English word in lower case (「meeting を始めよう」): it hands the learner the
  answer. The lint rejects a Latin word that starts lower case unless it is a unit or
  one of the few names that do (iPhone, macOS).

## `en` — the model answer

- What a fluent speaker would naturally say in that scene, at the card's level. Not the
  most literal rendering of the Japanese, and not a showcase of rare vocabulary.
- Its length must sit inside the level's `words` range in `content/levels.json` — the
  lint rejects it otherwise, and the timer depends on it. Aim below the cap: no padding
  clause, no second detail the scene does not need.
- A higher level asks for a harder word, an idiom or phrasal verb, or a harder structure
  — not for more of the sentence.
- Contractions are fine and usually more natural in speech (`I'm`, `don't`).
- Ends with `.`, `?` or `!`. No `...`, no `…`.
- American spelling.

## `alternatives` — 2 or 3 other right answers

- Each must be something a fluent speaker would say **in the same scene with the same
  meaning and the same politeness**, so that a learner who said it should mark
  themselves right.
- They exist to stop a learner from marking themselves wrong for a correct answer.
  Prefer the variants learners are likely to produce (`Can we…` beside
  `Is it okay if we…`), not exotic ones.
- Not a trivial respelling of `en` (contraction vs. full form, punctuation only). The
  lint rejects those.
- At most the level's `words.max` words, like `en`; the lint rejects a longer one.
- If a variant shifts meaning or politeness, leave it out rather than include it.

## `point` — one line

- The one thing in this sentence a learner is most likely to get wrong, in Japanese, one
  line, at most 60 characters.
- Minimal grammar jargon. 「未来のことでも if 節は現在形」 is
  fine;「副詞節中における時制の中和」 is not.

## Tags

- `topic` / `subtopic` come from `content/taxonomy.json` only. The scene description
  there is what the sentence should be about.
- `level` from `content/levels.json`: judge by what it takes to produce the sentence
  quickly — its structure, the tier of its vocabulary, and the idioms or phrasal verbs
  it needs, as each level's `summary` names them. Length is never a reason for a higher
  level; every level caps it.
- `grammar`: 1–2 ids from `content/grammar.json`, the structures the card actually
  exercises. Each id's `minLevel`–`maxLevel` must include the card's level. Never shown
  to the learner.

## Within one batch for one cell

- Vary the subject (I / you / we / he / she / they / a named role), the sentence type
  (statement, question, request, negative) and the situation within the subtopic.
- Do not reuse the same opening phrase more than twice.
- Nothing close to an existing card or a tombstone in the same cell (you are given
  both).

## Things never to write

- Anything a learner would feel awkward saying aloud on a train: no insults, slurs,
  sexual content, or graphic violence. Mild complaints and apologies are fine.
- Real people's names in a way that says something about them; brand names only where
  the scene needs one.
- Facts that go stale (prices, current events, version numbers).
