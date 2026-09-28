# Reviewer briefs

Each reviewer is a separate sub-agent with no repository access needed. Send only what
its section lists — withholding is the point, above all for R1. Every brief ends with
the output contract from `content/guides/review-perspectives.md`.

R2 and R3 keep "Think the problem through before you answer.": at medium effort Sonnet
5.5 often answers a rule-checking task that returns JSON without thinking first, and
Anthropic's prompting guide for it names this line as the fix.

If the owner passed `--note`, append to every brief: "The owner noticed this while using
the app: {note}. Check it specifically."

## R1 — blind composition

Send, per card: a label (`b1`, `b2`, … in batch order — never the card id), `ja`, and
`level` with its `summary` and `words` range from `content/levels.json`. Nothing else.
Keep the label → id map yourself and map the reply back.

> You are a fluent English speaker helping build a Japanese→English speaking drill. For
> each Japanese sentence below, write 1–3 English sentences a fluent speaker would
> naturally say in that situation, at the given level, most likely first, each within
> the level's word range and as short as the situation allows. Work only from what is in
> this message: do not open, search or read any file in the repository or anywhere else.
> Do not explain. Return only a JSON array: `[{ "label": "b1", "sentences": ["…"] }]` —
> one element per sentence, every label included.

## R2 — naturalness and correctness

Send, per card: `id`, `ja`, `en`, `alternatives`, and its level's `words` range and
`jaChars.max` from `content/levels.json`. Also the full text of
`content/guides/writing.md` and the R2 section of
`content/guides/review-perspectives.md`.

> You are reviewing cards for a Japanese→English speaking drill. A learner sees `ja`,
> speaks, then grades themselves against `en` and `alternatives`, so an unnatural answer
> is practised and a missing or wrong alternative makes them mark a right answer wrong.
> Apply checks R2.1–R2.6 strictly: "grammatical but a native speaker would not say it"
> is a failure. `en` and each alternative stay within the card's `words` range and `ja`
> within its `jaChars.max`, and for R2.6 a sentence that could lose words without losing
> its point is a `FIX` — the level's difficulty comes from vocabulary, idiom and
> structure, never from length. Think the problem through before you answer. Return only
> the failing cards, as the JSON array in the output contract.

## R3 — tags and point

Send, per card: the whole card. Also `content/levels.json`, `content/grammar.json`,
`content/taxonomy.json`, the R3 section of `content/guides/review-perspectives.md`, this
batch's `cards:dupes --json` output, and `cards:show --cell <topic>/<subtopic> --brief`
for every cell the batch touches.

> You are checking the metadata of cards for a Japanese→English speaking drill. Apply
> checks R3.1–R3.5. For R3.1, judge the level by structure, vocabulary and idiom; every
> level caps length, so a short card can still be a high level. For R3.5, the candidate
> list is only a lead; judge by whether two cards are effectively the same question,
> against every card listed for its cell. Think the problem through before you answer.
> Return only the failing cards, as the JSON array in the output contract.
