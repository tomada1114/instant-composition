# Card identity: edit in place or rebuild

A card's `id` is what the learner's history (right/wrong and seconds) is keyed on. The
one question that decides whether a change keeps the id:

> **Could the right/wrong and seconds recorded before the change still be compared, as
> answers to the same question, with those recorded after it?**

Yes → **edit in place** (same id). No → **rebuild**: move the old card to
`content/tombstones.jsonl` with `replacedBy`, and write a new card with a new id.

| Edit in place (same id)                                                                                                  | Rebuild (tombstone + new id)                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Fixing a typo, punctuation, an article or other outright error                                                           | The meaning of `ja` changes: who, what, when, positive/negative, request vs. suggestion             |
| Making `ja` more natural without changing its meaning                                                                    | The skeleton of `en` changes: tense, sentence pattern, main-clause structure                        |
| Adding a cue to `ja` that pins the skeleton (e.g. 「もう」 for a perfect) — **only when `en` already had that skeleton** | The main grammar item the card exercises changes                                                    |
| Swapping words in `en` (start → begin), or a more natural phrasing with the same skeleton                                | `en` changes length enough that the timer moves by roughly ×1.5 or more, or to roughly ×2/3 or less |
| Adding, removing, or replacing alternatives                                                                              |                                                                                                     |
| Rewriting `point`                                                                                                        |                                                                                                     |
| Retagging `topic`, `subtopic`, `level` or `grammar`                                                                      |                                                                                                     |

- Retagging the level keeps the id: the question is the same; the app's difficulty
  adjustment simply uses the current tag.
- A card that is still flagged after being fixed once (the second review round) is
  **deleted**, not rebuilt. Do not keep sentences that resist fixing.
- Deleting also goes to `content/tombstones.jsonl` (without `replacedBy`). An id in a
  tombstone is never reused.
