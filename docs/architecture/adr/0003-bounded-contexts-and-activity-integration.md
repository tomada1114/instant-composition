# ADR-0003: Bounded contexts and activity integration

- Status: Accepted (boundaries now, vocabulary later); the context list is Proposed
- Date: 2026-09-23
- Deciders: the owner

## Context

The product is growing from one activity, instant composition, into a language-learning
application with several. The second activity will be vocabulary. It exists today as a
separate prototype (a separate repository) built from the same template. The owner has
decided to cut the boundaries now and to rebuild vocabulary later as a second activity,
without copying its code.

The two codebases model the same ideas differently:

| Concern    | Composition (this repository)                                                               | Vocabulary prototype                                                                    |
| ---------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Scheduling | Leitner boxes replayed from all first-pass answers (`src/core/card-state.ts:23-41`)         | FSRS through ts-fsrs, wrapped in one pure module (`vocab: src/core/scheduler.ts:56-60`) |
| History    | `AnswerRecord` with a copy of the card's placement (`src/core/types.ts:40-58`)              | `review_log` with the state before and after each review                                |
| Levels     | 1–10, each with a rough CEFR band and exam scores (`content/levels.json`)                   | CEFR A1–C2                                                                              |
| Session    | Rounds, day portions, placement, streak and points (`src/server/services/finish.ts:57-121`) | Sessions with a scope and a daily new-card limit                                        |
| Learner    | None; settings are a single row (`src/server/db/migrations.ts:10`)                          | None; one card state per card id                                                        |

The integration aim is that activities reinforce each other. A grammar weakness found in
composition should influence what comes up next, a word learned in vocabulary should
appear in composition prompts, and one daily goal should count both. That aim decides
what must be shared.

## Decision drivers

- Share what cross-activity features need to read. Keep separate what each activity
  shapes differently.
- Make the future vocabulary rebuild a new module, not a change to composition's
  internals.
- Keep the learning history complete enough to change schedulers without losing
  progress.

## Considered options

1. One shared "study" module holding both activities' sessions and cards. Rejected: the
   session mechanics differ (timed rounds with portions and placement versus
   rating-based queues), and one module would force a lowest common denominator.
2. Fully separate activities that share only the learner id. Rejected: cross-activity
   weakness tracking and a shared daily goal would each need a private copy of the other
   activity's history.
3. Separate activity modules over a shared learning record and learner model (chosen).

## Decision

### Contexts

Each context is a module with a public surface
([ADR-0002](0002-architecture-style-and-repository-layout.md)). Those marked "now" are
built during the restructure; the rest arrive with the features that need them.

| Context              | Owns                                                                                                                              | When  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----- |
| identity             | LearnerId and its mapping to the Cognito `sub`; profile (timezone, L1, UI locale); account deletion and export                    | now   |
| catalog              | Items, taxonomy, grammar inventories, levels, as versioned read-only snapshots ([ADR-0004](0004-multi-language-content-model.md)) | now   |
| practice-composition | Rounds, day portions, placement, level changes, deck composition                                                                  | now   |
| learning-record      | The append-only review log and each item's memory state; due queries                                                              | now   |
| engagement           | Streak, points, titles, daily goal                                                                                                | later |
| practice-vocabulary  | Vocabulary sessions, scopes, new-item limits                                                                                      | later |
| learner-model        | Weaknesses and strengths per concept (grammar point, lexeme, topic)                                                               | later |
| assessment           | LLM grading and feedback jobs, rubric versions ([ADR-0011](0011-llm-integration-and-evaluation.md))                               | later |
| entitlements         | The usage ledger and plan state ([ADR-0010](0010-entitlements-and-billing.md))                                                    | later |

Items cross contexts only as references:

```ts
type ItemRef = { readonly kind: "composition" | "vocabulary"; readonly id: string };
```

### What is shared and what is not

| Concern                           | Decision                                                                      | Why                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Learner                           | Shared (identity)                                                             | One account across activities and clients                                               |
| Learning history                  | Shared envelope in learning-record; activity-specific detail in a payload     | The learner model and the daily goal read across activities                             |
| Weaknesses                        | Concept-level in learner-model (shared); item-level lapses in learning-record | A grammar concept or lexeme links activities; a single card's lapses do not             |
| Scheduling algorithm              | Shared (learning-record)                                                      | One memory model per item, whichever activity reviewed it                               |
| Deck and session composition      | Per activity                                                                  | Mix rules such as `TUNING.mix` (`src/core/tuning.ts:22-26`) are specific to composition |
| UI, session mechanics, item shape | Per activity                                                                  | They differ, and sharing them couples releases                                          |

The review log envelope:

```ts
interface ReviewEntry {
  readonly id: string; // client-generated; duplicates are ignored (ADR-0007)
  readonly learnerId: LearnerId;
  readonly item: ItemRef;
  readonly activity: "composition" | "vocabulary";
  readonly sessionId: string; // a round or a vocabulary session
  readonly answeredAt: number; // client-reported, bounded (ADR-0007)
  readonly day: DayKey; // the session's practice day in the learner's timezone
  readonly outcome: Outcome; // common scale, below
  readonly before: MemoryState | null;
  readonly after: MemoryState;
  readonly snapshot: ItemSnapshot; // topic, level, prompt text at answer time
  readonly payload: unknown; // activity-specific: pass, elapsedMs, limitMs, typed text
}
```

The snapshot keeps today's practice of copying card placement into each answer, so the
record outlives a deleted card (`src/core/types.ts:53-57`).

### Scheduling

- Composition keeps its Leitner boxes until vocabulary is rebuilt. From the restructure
  onward, the log records a common outcome and the before and after state.
- When vocabulary arrives, both activities move to FSRS through a pure wrapper, as the
  prototype does: ts-fsrs is imported in one module, time is an argument, and library
  types do not leak out.
- Composition outcomes map to FSRS ratings: `ng` and `timeout` → Again, `ok` → Good, a
  fast `ok` (under the fast ratio, `src/core/tuning.ts:14`) → Easy. Vocabulary keeps its
  native four ratings.
- At the switch, composition history is replayed through FSRS to seed item states. The
  log is kept whole partly so that this replay is possible.

### Engagement

Streak, points and titles stay inside practice-composition until vocabulary exists. They
are then extracted into engagement, where the daily goal counts both activities.
Extracting earlier would design a cross-activity rule with only one activity to test it
against.

## Consequences

### Positive

- Vocabulary becomes a new module plus catalog content, not a change to composition's
  internals.
- The learner model has one log to read, whatever produced the entries.
- A scheduler change is a replay, not a data loss.

### Negative

- The shared envelope is designed before its second producer exists. Vocabulary may
  reveal fields it lacks; the `payload` escape hatch limits the damage, but a migration
  is still possible.
- Keeping before and after state on every entry makes the log several times larger than
  today's answers table.
- Running Leitner and logging FSRS-ready outcomes side by side means that, for a while,
  two memory models describe the same answers.

### Follow-ups

- Choose FSRS parameters and the retention target when vocabulary is rebuilt. The
  prototype uses `request_retention: 0.9` with fuzz and short-term steps enabled
  (`vocab: src/core/scheduler.ts:56-60`).
- Decide when the FSRS optimizer runs; the prototype leaves this open.

## Open questions

- Whether engagement's daily goal counts reviews, minutes or completed sessions once two
  activities feed it.
- How the learner model weights evidence from typed-and-graded answers
  ([ADR-0011](0011-llm-integration-and-evaluation.md)) against self-graded ones.

## Sources

Code in this repository at commit d2a5cd9, and the vocabulary prototype's source. No
external facts are relied on.

## Related

- [ADR-0002](0002-architecture-style-and-repository-layout.md) — module mechanics
- [ADR-0004](0004-multi-language-content-model.md) — items and concepts
- [ADR-0006](0006-persistence-on-dynamodb.md) — how the log and projections are stored
- [Roadmap](../roadmap.md)
