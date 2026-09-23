# Review perspectives

perspectivesVersion: 1

The checks each independent reviewer applies. Bump `perspectivesVersion` above whenever
a check is added or materially changed; every card stamped with an older version then
re-enters the review queue a batch at a time. Rewording that changes no verdict does not
need a bump.

Every reviewer returns only the cards that fail, one entry per problem:

```json
{
  "id": "c_7k2m9x4q",
  "reviewer": "R2",
  "check": "R2.3",
  "verdict": "FIX",
  "confidence": "high",
  "problem": "…",
  "suggestion": "…"
}
```

`verdict` is `FIX` (repairable in place under `identity.md`), `REBUILD` (a repair would
change the question) or `DROP` (not worth keeping). `confidence` is `high`, `medium` or
`low`.

## R1 — blind composition

Shown `ja` and `level` only — never `en`, `alternatives` or `point`.

- **R1.1** Write 1–3 English sentences a fluent speaker would say for this `ja` at this
  level, the most likely first.

R1 returns its sentences for every card, not only failures. The orchestrator compares: a
sentence whose skeleton (subject, tense/aspect, polarity, sentence type, politeness)
differs from `en` means either `ja` does not pin the skeleton (fix `ja`) or a valid
alternative is missing (add it). A sentence with the same skeleton that is a natural and
likely learner answer, missing from `alternatives`, is a candidate to add. This turns
"is the Japanese unambiguous?" from an opinion into an observation.

## R2 — naturalness and correctness

Shown `ja`, `en`, `alternatives`.

- **R2.1** `en` and every alternative are grammatically correct.
- **R2.2** A fluent speaker would actually say each of them in this scene — not merely
  grammatical. Flag stiff, textbook or dated phrasing.
- **R2.3** Each matches `ja` in meaning and politeness; no alternative drifts.
- **R2.4** `ja` is natural Japanese, not translationese, and pins the English skeleton
  (see `writing.md`).
- **R2.5** Nothing from "Things never to write" in `writing.md`.

## R3 — tags and point

Shown the whole card, `content/levels.json`, `content/grammar.json`,
`content/taxonomy.json`, and the near-duplicate candidates from `pnpm cards:dupes`.

- **R3.1** `level` fits the card by the definitions in `levels.json` (off by one is a
  `FIX` retag; off by more is also a `FIX` retag, never a rebuild).
- **R3.2** `grammar` names what the card actually exercises, 1–2 ids.
- **R3.3** `subtopic` fits the scene described in `taxonomy.json`.
- **R3.4** `point` is correct, is the single most useful thing to notice, and follows
  `writing.md`.
- **R3.5** No other card is effectively the same question (same scene, same skeleton,
  near-identical `ja`). Flag the newer one as `DROP`.
