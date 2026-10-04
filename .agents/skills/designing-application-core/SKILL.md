---
name: designing-application-core
description: >
  Covers how domain and application code is shaped: pure domain rules with time and
  timezone passed in, commands and queries as data handled as load, decide, commit,
  projections over append-only logs, ports only at real seams, and bounded contexts as
  modules. Use when adding or rewriting a rule in packages/domain, a command, query or
  port in packages/application, a store method or adapter in packages/adapters, a
  conditional write, an idempotency key, or code that reads the clock, a timezone or a
  random seed; or when weighing a new layer, package or abstraction.
---

# Designing the Application Core

**Owns:** the shape of domain and application code — the direction dependencies run,
what must stay pure, how a command and a query flow, where a port may exist, and which
patterns are deliberately not adopted. **Does not own:** TypeScript idiom
(`writing-typescript`); the HTTP edge (`serving-the-api`) and the web client
(`building-web-screens`); error types and codes (`designing-errors`); who may touch
whose data (`isolating-learner-data`); the system map — which packages, contexts, tables
and services exist and why (`mapping-the-architecture`).

## Where the code is

`packages/domain` holds the rules, `packages/application` the commands, queries, ports,
request context and authorization, and `packages/adapters` the stores and the catalog;
`apps/api` wires adapters to the application. The packages and their edges are
AGENTS.md's "Architecture" and `eslint.config.mjs`'s tables, asserted again by
`tests/boundaries.test.ts`; read them there. Which context lives where, the key layout
and the endpoint list: **BACKGROUND:** `mapping-the-architecture`.

## Dependencies run one way

The domain imports nothing outside itself — no package, no Node builtin. The application
layer imports the domain and declares the ports it needs. Adapters implement ports.
Entry points wire adapters to the application and translate a transport into commands
and queries. Nothing inward names anything outward — that is what let the domain survive
the removal of a whole language-model layer and then of the framework it was first
written under.

## The domain is pure

- No I/O, no `Date.now()`, no `Math.random()`, no `process.env`, and no process
  timezone. Time arrives as epoch milliseconds, the learner's timezone and day boundary
  as arguments, randomness as a seed. `dayOf` in `packages/domain/src/day.ts` takes the
  learner's IANA time zone for that reason: a rule reading the process timezone would
  move a Tokyo learner's practice day by nine hours on a server running in UTC.
- Rules are functions over plain readonly data. Safety comes from branded types and zod
  schemas, not from classes.
- Tunable values live in one object, as `TUNING` in `packages/domain/src/tuning.ts`
  does, never scattered as literals.
- A rule that follows a published library is written into the domain rather than
  imported, and pinned by golden vectors the library computed outside this repository.
  The FSRS-6 schedule (`fsrs*.ts`) is the case: ts-fsrs 5.4.2 enters no manifest, its
  MIT notice heads each adapted module, and `tests/fixtures/fsrs-golden.json` records
  the options, the inputs and the script that made its vectors. A schedule counts days
  as the difference of two `DayKey`s, never of wall-clock time.

## Commands and queries

- A write is a **command**: plain data, validated at the edge, carrying the ids the
  client generated. Its handler loads the state it needs, calls a pure `decide` in the
  domain, and **commits** the resulting changes as one atomic conditional write whose
  conditions state what must still hold ("the round is open", "this answer id is new").
  A failed condition is re-run or answered with a domain error — never retried blindly.
- No port method brackets reads and writes around a caller's callback (a
  `transaction(body)`). DynamoDB has no interactive transaction, and a caller-held one
  hides the consistency boundary inside the caller. `LearnerStore.commit` in
  `packages/application/src/store.ts` is the shape instead: the writes and deletes, plus
  the versions each read must still hold.
- A read is a **query** answered from projections — item memory, learner totals —
  maintained on write, never by replaying the whole history per request.
- Append-only logs (answers, reviews) are what projections are rebuilt from. Keep them:
  changing the scheduler or rebuilding a projection replays the history. Each entry
  keeps the state before and after and a snapshot of the item, as `ReviewEntry` does, so
  it outlives the item.
- Commands are data so that any entry point — the HTTP API now, a job or a tool if one
  is added — runs the same command behind one authorization check.

## Idempotency

- A command that can be retried carries an identity the client made (an answer id, a
  round id), and the commit's condition turns a repeat into a no-op that returns the
  first result. An answer whose client-made id a round already holds is skipped
  (`packages/domain/src/answers.ts`). A round adopts the first successfully committed
  first answer for each card; later valid first answers under different ids succeed
  without changing that answer, counters or FSRS. A transaction chunk chooses in clamped
  answer-time/id order, and earlier committed chunks prevail. Multiple retries still get
  separate log entries. Adoption is loaded from the round's bounded `answerState`
  projection and guarded by its version in the same transaction. A legacy round
  initializes that projection in separately checkpointed log pages before recording;
  answer ids, progress and personal cards otherwise use keyed reads alone. The answers
  endpoint keeps its empty 204 response; reload and summary return the adopted result.
  After finish, only recorded-id resends are accepted, preserving the closed-round
  validation. Finishing a finished round answers with the summary it kept
  (`packages/application/src/finish-round.ts`).
- For non-deterministic work, idempotency means storing the first result under the
  work's key and returning it — not expecting the same output twice.
- Offline clients send late. Accept an answer for an older round, take its day from the
  round, and bound a client timestamp by the round's start and the server's clock.

## Ports and contexts

- A port exists only where two or more real implementations do: the store and the
  learner directory (in-memory, DynamoDB), the catalog (the snapshot file, an in-memory
  snapshot in tests), the authenticator (Cognito, the local stand-in, locally signed
  test tokens), the clock and ids. A pure rule is not a port — swap the function.
- Ports are async even where an implementation is synchronous.
- A context (the list is `mapping-the-architecture`'s) is a module with one surface.
  Another context is reached through that surface, and data it needs is passed or
  copied, never read from its storage.
- A consistency boundary decides what one commit may touch: a round with its answers, a
  day's portion, one item's memory, the settings. A command that needs two is a sign it
  should be two commands.

## Deliberately not adopted

| Pattern                                                | Why not                                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Use-case interactor classes, presenters, per-layer DTO | A function per command or query already is the use case; copies between layers add no consumer |
| Entity classes, a repository per entity, value objects | Plain data and pure functions test more easily; branded types and zod carry the safety         |
| A domain event bus or a command bus framework          | Direct calls; an event appears only when an async consumer does                                |
| Full event sourcing                                    | Logs are kept only where history has a named use; everything else is state                     |

Adopting one is an architecture change: the pull request names the problem the current
shape cannot solve and updates `mapping-the-architecture`, whose own table covers the
system-level patterns not adopted (microservices among them).

## Testing the shape

A `decide` function gets plain unit tests built from worked examples; a command runs
against the in-memory store; every store adapter runs the shared contract suite, whose
isolation half **REQUIRED:** `isolating-learner-data` owns. **BACKGROUND:**
`writing-tests` for how each case is written.
