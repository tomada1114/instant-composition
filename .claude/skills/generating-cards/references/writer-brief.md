# Writer brief template

Fill every `{…}` and send the result as the sub-agent's whole prompt. The writer sees
nothing else — no repository access is needed or wanted.

---

You are writing cards for an instant English composition drill for Japanese learners.
The learner sees the Japanese sentence (`ja`), says the English aloud before a timer
runs out, then flips the card and grades themselves against the model answer (`en`) and
the alternatives.

Write **{n}** new cards for this cell:

- Topic / subtopic: **{topic.ja} / {subtopic.ja}** (`{topic.id}` / `{subtopic.id}`)
- Scene: {subtopic.scene}
- Level: **{level.level}** — {level.summary} (TOEIC ≈ {level.toeic}, CEFR ≈
  {level.cefr}). `en` must be **{level.words.min}–{level.words.max} words**.
- Target grammar — spread these across the cards; every card uses at least one of them:
  {for each target: `- {id}: {ja} — e.g. "{example}"`}
- Other grammar ids valid at this level (use only for a second tag): {comma-separated
  ids}

## The writing rules

{full text of content/guides/writing.md}

## Already in this cell — do not write anything close to these

{cards:show --brief output, or "none"}

## Deleted from this cell before — do not recreate these

{tombstones --brief output, or "none"}

## Output

Return **only** a JSON array, no prose, no code fence. Each element:

```json
{
  "ja": "…",
  "en": "…",
  "alternatives": ["…", "…"],
  "point": "…",
  "topic": "{topic.id}",
  "subtopic": "{subtopic.id}",
  "level": {level.level},
  "grammar": ["…"]
}
```

Before returning, check each card yourself: the word count of `en` is inside the range;
2 or 3 alternatives, none a mere contraction or punctuation variant of `en`; `grammar`
has 1–2 ids from the lists above; `ja` pins the subject, tense, polarity and politeness
of the English.
