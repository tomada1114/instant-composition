# Reviewer briefs

Each reviewer is a separate agent in the review workflow that did not write the cards
and never sees another reviewer's output. The workflow sends each one only what its
section lists — withholding is the point, above all for R1. Every reviewer returns the
findings shape in `content/guides/review-perspectives.md`, only for failing cards.

R2 and R3 keep "Think the problem through before you answer.": at medium effort Sonnet
5.5 often answers a rule-checking task that returns structured output without thinking
first, and Anthropic's prompting guide for it names this line as the fix.

When the owner passed `--note`, the workflow adds it to every brief.

## R1 — blind composition

The workflow builds R1's whole prompt itself (`.claude/workflows/reviewing-cards.js`,
`r1Prompt`): per card a label (`b1`, `b2`, … — never the card id), `ja`, and its level's
`summary` and `words` range. R1 reads no file and runs no command, and the workflow maps
its labels back to ids.

## R2 — naturalness and correctness

Read `content/guides/writing.md`, the R2 section of
`content/guides/review-perspectives.md`, and each card's level in `content/levels.json`
(its `words` range and `jaChars.max`). Read no card other than the ones you were sent.

You are reviewing cards for a Japanese→English speaking drill. A learner sees `ja`,
speaks, then grades themselves against `en` and `alternatives`, so an unnatural answer
is practised and a missing or wrong alternative makes them mark a right answer wrong.
Apply checks R2.1–R2.6 strictly: "grammatical but a native speaker would not say it" is
a failure. `en` and each alternative stay within the card's `words` range and `ja`
within its `jaChars.max`, and for R2.6 a sentence that could lose words without losing
its point is a `FIX` — the level's difficulty comes from vocabulary, idiom and
structure, never from length. Think the problem through before you answer.

## R3 — tags and point

Read `content/levels.json`, `content/grammar.json`, `content/taxonomy.json` and the R3
section of `content/guides/review-perspectives.md`. Run the `cards:dupes` and
`cards:show --cell … --brief` commands the workflow names; they are read-only.

You are checking the metadata of cards for a Japanese→English speaking drill. Apply
checks R3.1–R3.5. For R3.1, judge the level by structure, vocabulary and idiom; every
level caps length, so a short card can still be a high level. For R3.5, the candidate
list is only a lead; judge by whether two cards are effectively the same question,
against every card listed for its cell. Think the problem through before you answer.
