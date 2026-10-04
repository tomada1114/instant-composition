# Runtime contexts

## Layers and contexts

The workspace, its packages and the one-way import rule are AGENTS.md's "Architecture"
section, enforced by `eslint.config.mjs` and `tests/boundaries.test.ts`; read them
there. The domain names nothing outward, which is what let it outlive the framework it
was first written under.

The bounded contexts are modules inside those packages, not packages or services of
their own:

| Context              | What it holds                                              | Where it lives                                                                                                             |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| identity             | `sub` → internal `LearnerId`, the learner's profile        | `LearnerDirectory` (`sign-in.ts`), `profile.ts`; the two directory adapters                                                |
| catalog              | cards, topics, levels and grammar concepts, read-only      | the `Catalog` port (`catalog.ts`, `catalog-document.ts`); `snapshotCatalog`; `scripts/catalog/build.mjs`                   |
| practice-composition | rounds, day portions, placement, level, deck composition   | domain's `compose*`, `drill-queue`, `deck`, `start*`, `placement`, `difficulty`; application's round and settings commands |
| learning-record      | the append-only review log and each item's FSRS projection | domain's `records.ts`, `review.ts` and `card-state.ts`                                                                     |
| learner-model (v0)   | weak grammar concepts and subtopics                        | domain's `weakness.ts`, derived when read                                                                                  |
| vocabulary           | vocabulary cards' progress, sessions and today's queue     | domain's `vocab*.ts` over `fsrs.ts` and `queue.ts`; application's `vocab-*.ts`                                             |
| talk                 | a talk's scene and turns, and its four model tasks         | domain's `talk*.ts`; application's `start-talk.ts`, `send-turn.ts`, `end-talk.ts` and `talk-*.ts`                          |

- Streak, points and titles live inside practice-composition and count the drill alone.
  Items cross contexts only as an `ItemRef` (`kind` plus `id`), so a second activity
  adds a `kind` rather than changing composition.
- The talk shares no data with the drill; the streak, the points and the records stay
  the drill's. The server runs a talk's steps in a fixed order and refuses one out of
  order; the scene, teacher, partner and cards tasks — each a versioned prompt, a JSON
  Schema and a `read` — are the application's, shared by every model adapter. A kept
  talk with a corrected turn offers card candidates through one `talk-cards` call, kept
  on the talk (`POST /v1/talks/{talkId}/candidates`), and adds the learner's picks to
  the vocabulary (`…/cards`): a candidate whose headword a catalog card holds marks that
  card as from the talk, any other becomes a personal card. The card rules a model's
  card has to meet are the lint's, written again in the domain (`vocab-card.ts`) and
  held to it by a test. `GET /v1/talks/{talkId}` reads the learner's own unexpired talk,
  with no model call or write, so this browser can resume an open talk after a reload
  from its locally saved id. **REQUIRED:** `building-the-talk-activity`.
- The vocabulary context schedules each card with FSRS-6 (`fsrs.ts`): its own items,
  sessions and append-only answers, keyed apart from the drill's, and only a card's
  first answer of a practice day moves it. Today's queue, a category's share of it and
  the weak cards (from a talk, or eight lapses, until a stability of 21 days) are
  derived when read from the items and the catalog, under the daily limits in the
  settings. It reads the drill's level for the new cards' band and shares nothing else:
  the streak, the points and the records stay the drill's. It deals the catalog's cards
  and the learner's personal cards, made from a talk and kept in their own partition,
  never in the catalog; a personal card is shown only for the language pair it was made
  for. The hub also derives the next extra and weak sessions' available counts, globally
  and per category, from one request-local domain plan: queue, extras, weak cards and
  the category index are derived once, with no module-global cache. Finished summaries
  use the domain's pure review summary: it keeps the first log entry for each card in
  input order through a single Set-based pass. The client uses a fresh read after
  finishing to offer only sessions that can deal a card. Settings expose both
  activities' limit choices from domain tuning. Its routes are `GET /v1/vocab` (the hub)
  and `POST /v1/vocab/sessions`, with a session's `…/{sessionId}/answers` and
  `…/finish`, and `DELETE /v1/vocab/cards/{cardId}`, which removes a personal card and
  its progress but not its logged answers.
- The learner model stores nothing: it is a pure pass over item projections the reads
  already load. Grammar weaknesses feed the deck; subtopic weaknesses are only shown.
- The drill schedules each card with FSRS-6 (`fsrs.ts`), on the same rule as the
  vocabulary: only a card's first answer of a practice day moves it; a re-ask and any
  later answer that day are logged and move nothing. An answer carries a `grade`
  (`again`, `hard`, `good`) and `timedOut`, and an older client's `result` still maps
  onto them. Each review logs the grade, `timedOut`, the seconds and the FSRS state
  before and after (`fsrs`), beside the `result` the figures count — said in time is
  hard or good not timed out, a weakness miss is again or timed out — so the reach,
  weakness and growth code reads what it always read. State-changing composition reviews
  and their item projections share a per-item causal revision in the same commit. Replay
  follows the before/after state chain and validates revisions, including unambiguous
  legacy Leitner and FSRS logs; a broken or ambiguous chain fails closed. Client answer
  times order display and analysis alone. A replay copies the stored state rather than
  recomputing it, so a scheduler change applies from the next answer and never rewrites
  the past.
- An item holds its FSRS state as `fsrs`; the Leitner `memory` of a card answered before
  FSRS stays in it, read only for its presence. A card with that history and no state is
  dealt in the review quota as not new, with a new card's intervals, and its next first
  answer schedules it as one. Today's queue (`drill-queue.ts` over `queue.ts`) deals due
  reviews by lowest retrievability with new cards spread among them, under the drill's
  daily limits in the settings (`newPerDay`, `reviewsPerDay`); only the number of new
  cards comes from the limit, which ones is the focus, weak and level shares' choice. A
  portion under five is topped up with cards not yet due; an extra round deals due
  reviews past the limit, then new cards past it. `dailySize` is still stored and served
  but sizes nothing.

How a context exposes its surface: **REQUIRED:** `designing-application-core`.
