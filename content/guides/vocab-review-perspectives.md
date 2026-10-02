# Vocabulary review perspectives

The checks a reviewer applies to a vocabulary card (`content/vocab/`), as
`review-perspectives.md` holds them for the drill's cards. `vocab-writing.md` is the
yardstick each check points to; `identity.md` decides edit against rebuild.

A vocabulary stamp records the `perspectivesVersion` of `review-perspectives.md`: the
`pnpm cards:*` commands read that one number for both kinds. A check added here, or
changed so a verdict changes, bumps it there, which sends the drill's stamped cards back
to the queue as well. Rewording that changes no verdict needs no bump.

Each failure gets a verdict: `FIX` (repairable in place under `identity.md`), `REBUILD`
(a repair would change the question) or `DROP` (not worth keeping), with a confidence of
`high`, `medium` or `low`.

## V1 — blind recall

Shown the front only — `category`, `level`, `definition` and `example` with each `{{…}}`
mark as a blank — never `headword`, `meanings` or `example2`.

- **V1.1** Write the 1–3 answers a learner at this level who knows English well would
  put in the blanks, the most likely first, one word per blank.

The reviewer then compares. The headword first, or alone: the front works. Another
answer first that fits as well: the front does not pin the headword — V2.2 or V2.3 names
what is wrong. Nothing fits the number of blanks: V2.4.

## V2 — the front picks out the headword

- **V2.1** `definition` does not contain the headword, nor a word that carries its
  meaning, in any form (`vocab-writing.md`, "`definition`"). A card whose definition
  gives the answer away is a `FIX`: rewrite the definition.
- **V2.2** `definition` picks out the headword alone: it is accurate for the sense the
  examples use, and a near synonym does not answer it just as well. For a `phrase` it
  says when and why the phrase is said.
- **V2.3** No more common word fills the blank. If a commoner word or phrase fits the
  blanks and the sentence as naturally as the headword, the card tests a guess: a `FIX`
  that adds the detail ruling it out, or a sharper definition; a `REBUILD` when only
  another sentence would do.
- **V2.4** The blanks follow `vocab-writing.md`, "`example` — the cloze": one `{{…}}`
  mark per blanked word, punctuation outside the marks, every headword word blanked
  except a placeholder, a split phrasal verb's object between its marks, and a
  `phrase`'s blank in the line that says it.

## V3 — natural, current English

- **V3.1** The headword, `definition`, `example` and `example2` are correct English.
- **V3.2** A fluent speaker would say the headword and both examples today, in that
  situation — not textbook, stiff or dated phrasing, and not an idiom only learners'
  books still use. American spelling.
- **V3.3** `example2` shows the headword in another context, not the first example
  reworded (`vocab-writing.md`, "`example2`").
- **V3.4** Nothing from "Things never to write" in `vocab-writing.md`.

## V4 — the meaning

- **V4.1** Each meaning (`meanings.ja`, and any other language the card holds) matches
  the sense both examples use — not another sense of the headword, and not a gloss wider
  than the examples show.
- **V4.2** It is natural, within its cap, and follows `vocab-writing.md`,
  "`meanings.ja`". For a `phrase`, it is what a speaker of that language would say in
  the same turn.

## V5 — tags and duplicates

Shown the whole card, `content/levels.json`, the `pnpm cards:dupes --kind vocab` pairs
and the headwords already in the category.

- **V5.1** `category` fits the headword by `vocab-writing.md`, "Categories" (off is a
  `FIX` retag).
- **V5.2** `level` fits by `vocab-writing.md`, "`level`" — frequency and register, never
  length (off by any amount is a `FIX` retag).
- **V5.3** No other card is effectively the same headword: a `cards:dupes` pair, the
  same expression in another category, or a variant of another card's headword
  (`give up` and `give up on`). Flag the newer one as `DROP`.
