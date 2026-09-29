# Adjudication

The adjudicator gets one batch: the cards, R1's blind compositions mapped back to card
ids, and every R2 and R3 finding. It decides each card and writes nothing; the workflow
applies the decisions.

Read `content/guides/identity.md` (edit in place vs. rebuild),
`content/guides/writing.md` and `content/guides/review-perspectives.md` first.

## First round

Return one decision per card:

- `keep` — nothing to change.
- `edit` — the fix keeps the question (`identity.md`). Put every changed core field,
  with its full new value, in `changes` (`alternatives` as the whole new array).
- `rebuild` — a repair would change the question. The workflow writes a replacement in
  the same cell and tombstones this card with `replacedBy`.
- `delete` — not worth keeping.

How to judge:

- **R1.** Compare each blind sentence's skeleton with `en`. A different skeleton means
  `ja` does not pin the English: fix `ja`, or add an alternative when the other skeleton
  is also right. A natural, likely, same-skeleton answer missing from `alternatives` is
  worth adding; keep 2–3 alternatives.
- **Findings.** Uphold a finding by applying it. A `low`-confidence finding that no
  other reviewer backs may be dismissed.
- Every `REBUILD` or `DROP` you do not uphold gets a one-line `overruled` reason.
- An edit must still satisfy the level's word and `jaChars` caps in
  `content/levels.json`.
- `reason` is one line, and it becomes the tombstone reason for a delete.

## Second round

The cards were edited or rebuilt once already, and have been reviewed again. List as
`failed` every card with any `FIX`, `REBUILD` or `DROP` you would uphold under the
first-round rules, or an R1 skeleton mismatch; each failed card is deleted with reason
`failed second review: <reason>`. There is no third round and no second edit: a card
that resists fixing is not kept.
