# ADR-0004: Multi-language content model

- Status: Accepted
- Date: 2026-09-23
- Deciders: the owner

## Context

Today every card is a Japanese prompt with an English answer, and the UI is Japanese
only:

- A card's reviewed fields are `ja`, `en`, `alternatives`, `point`, `topic`, `subtopic`,
  `level` and `grammar` (`scripts/cards/schema.mjs:17-26`). The prompt language is part
  of the field name.
- `point`, the explanation shown after the answer, is written for Japanese speakers. It
  explains English by contrast with Japanese.
- Levels are 1–10. `content/levels.json` gives each one rough reference points — CEFR
  (from `A1+` at level 1 to `C1` at level 10), TOEIC, IELTS and TOEFL iBT — but the app
  reads only the TOEIC value (`src/server/content/parse.ts:31`, exposed as
  `toeicByLevel`, `src/server/content/load.ts:11`). `content/grammar.json` is an
  inventory of English grammar points with Japanese names.
- The UI ships one catalog, `messages/ja.json`, and one locale (`src/i18n/locales.ts`).
- A card is shown only when its `stamps.core` hash matches its current fields, which is
  how human review gates content. All 1,020 cards are stamped, and 324 deleted cards are
  recorded in `content/tombstones.jsonl` with a reason.

The owner has decided that the product will support more languages in both directions
eventually:

- More L1s: for example, Chinese or Spanish speakers learning English.
- More target languages: for example, Japanese speakers learning Chinese or Spanish.

Which pair comes next is not decided. The owner can review Japanese and English content,
and has decided that content in languages they cannot read will rely on LLM review only.

## Decision drivers

- Adding a language pair should add content and localizations, not change the schema.
- Reuse work across pairs that share a target language.
- The explanation must stay L1-specific, because a good explanation contrasts with the
  learner's own language.
- Quality claims for pairs the owner cannot read must rest on measurements, not on
  trust.

## Considered options

1. **Independent items per language pair.** ja→en, zh→en and es→en would be separate
   card sets. Each pair could be tuned freely, but generation, review and deduplication
   would multiply by the number of pairs, and the same English sentence would exist
   several times with separate learning histories.
2. **Target-anchored items with per-L1 localizations (chosen).** The item is the
   target-language sentence and its target-language metadata. Prompts and explanations
   are localizations attached to it.
3. **An L1-anchored item with per-target translations.** Rejected: grammar tags, levels
   and alternatives describe the sentence being produced, which is the target-language
   side.

## Decision

### Items

A composition item is anchored on its target-language sentence:

```ts
interface CompositionItem {
  readonly id: string;
  readonly target: LanguageTag; // "en"
  readonly text: string; // the model answer
  readonly alternatives: readonly string[];
  readonly concepts: readonly ConceptId[]; // e.g. "en:grammar/present-perfect"
  readonly level: number; // the target's 1–10 step; each step declares a CEFR band
  readonly topic: string;
  readonly subtopic: string;
  readonly stamps: { readonly core: Stamp };
  readonly localizations: Readonly<Partial<Record<LanguageTag, Localization>>>;
}

interface Localization {
  readonly prompt: string; // what the learner sees, in L1
  readonly explanation: string; // today's `point`, written for this L1
  readonly stamp: Stamp; // reviewed separately from the core
}
```

- An item is shown for a pair (L1 → target) only when both its core stamp and that L1's
  localization stamp are valid. Adding an L1 never invalidates existing stamps.
- A vocabulary item is a lexeme anchored in the target language, with per-L1 glosses and
  examples, following the same core-plus-localization split.

### Levels and concepts

- CEFR (A1–C2) is the canonical cross-language level, since it is defined across
  languages. The in-app 1–10 scale stays as a finer difficulty ladder per target
  language — placement and level changes need steps smaller than a CEFR band — and each
  step declares its CEFR band, as `content/levels.json` already does for English. Exam
  scales become per-target reference mappings: TOEIC, IELTS and TOEFL iBT for English
  today, and HSK or DELE if Chinese or Spanish targets are added.
- Concept ids are namespaced by target language: `en:grammar/present-perfect`,
  `en:lexeme/borrow`. The learner model
  ([ADR-0003](0003-bounded-contexts-and-activity-integration.md)) tracks weaknesses per
  concept, so a weakness is always about a specific language.
- Grammar inventories become one file per target language. Their display names become
  per-L1 localizations.

### Catalog snapshots

The catalog is built at deploy time into one snapshot per language pair, for example
`catalog/en/ja.json`, with a content hash as its version. The API serves the snapshot
for the learner's current pair, and answers record the snapshot version they were given.

As built in Phase 1 (`scripts/catalog/build.mjs`, typed by
`packages/application/src/catalog-document.ts`), `pnpm catalog:build` writes
`dist/catalog/<target>/<l1>.json`, and the snapshot departs from the item sketch above
in three ways:

- **No stamps.** The builder resolves the stamps: an item enters `items` only when its
  core and its L1 localization are stamped as they stand. The rule that computes a stamp
  stays with the content tooling (`scripts/cards/schema.mjs`), so the API never needs
  it, and unreviewed text never leaves the build.
- **A `withdrawn` list.** An item edited since its review ships as its id, topic,
  subtopic, level and word count, with none of its text, so an answer that names it
  still resolves.
- **Tombstones with prompts.** A deleted item ships with its per-L1 prompt, the one it
  was deleted with.

The document also carries each level's CEFR band and exam references from
`content/levels.json`, and `version` is `sha256:<hex>` over the rest of the document.

### Languages in the profile

A learner's profile holds three separate settings:

- L1: the prompt and explanation language.
- Target: the language being learned.
- UI locale: the language of the app's interface. It defaults to L1 and can be changed
  independently.

UI strings stay in client catalogs (`messages/*.json` for the web). Content text comes
from the API.

### Quality without a human reader

For a pair the owner can read (ja→en), human review and the existing stamp flow remain
the gate. For any other L1 or target, the owner's decision is LLM review only. To make
that defensible:

1. **Measure the reviewer first.** Run it on ja→en, where human decisions exist: 1,020
   stamped cards as accepts, and 324 tombstones with written reasons as rejects. Report
   its agreement with those decisions.
2. **Cross-model agreement.** Review each localization with two different model families
   and hold back items where they disagree.
3. **Learner reports.** A "report this card" action feeds a queue that removes or
   revises items.
4. **Gate a pair's launch.** A new pair ships only when its automated gate passes: the
   reviewer's measured agreement on ja→en, the cross-model agreement rate on the new
   pair, and lint.

The trade-off is stated plainly: for those pairs there is no human ground truth, so the
measurements show that the reviewer is consistent, not that the content is correct for
native speakers.

### Migration

The rewrite renames `ja` to `localizations.ja.prompt` and `point` to
`localizations.ja.explanation`, and splits the stamp into core and localization stamps.
The card tooling (`pnpm cards:*`) moves with it. Existing stamps are re-issued
mechanically for fields that did not change, so migration does not force a re-review of
1,020 cards.

## Consequences

### Positive

- Adding an L1 for an existing target adds localizations only. Items, grammar tags,
  levels and learner histories are reused.
- Learners with different L1s who study the same target build histories on the same item
  ids, which makes cross-learner analysis possible.
- The quality claim for unreadable languages is explicit and measurable.

### Negative

- A sentence natural in the target language may have no natural prompt in some L1. Such
  an item simply lacks that localization, so pairs have uneven coverage.
- Two stamps per shown item make review tooling and linting more complex.
- The reviewer's accuracy on ja→en may not transfer to other languages. That risk is
  accepted, not eliminated.

### Follow-ups

- Rewrite `scripts/cards/schema.mjs` and the card commands for the new shape, and write
  a one-off migration for `content/cards/`.
- Read the CEFR band from `content/levels.json` instead of only the TOEIC value (done in
  Phase 1: the snapshot carries it), and move the file to a per-target location.
- Add a report-this-item command to the API
  ([ADR-0007](0007-http-api-contract-and-offline-sync.md)).

## Open questions

- Which pair comes next: a new L1 for English, or a new target for Japanese speakers.
- Whether vocabulary glosses need a separate review stamp from vocabulary examples.
- Whether a target language other than English keeps ten steps, or sizes its ladder to
  its own CEFR coverage.

## Sources

Code and content in this repository at commit d2a5cd9. No external facts are relied on.

## Related

- [ADR-0003](0003-bounded-contexts-and-activity-integration.md) — concepts and the
  learner model
- [ADR-0011](0011-llm-integration-and-evaluation.md) — the LLM reviewer and its
  evaluation
- [Vision](../vision.md), [Roadmap](../roadmap.md)
