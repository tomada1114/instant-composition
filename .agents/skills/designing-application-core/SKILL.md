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
whose data (`isolating-learner-data`); the decisions themselves, which are ADR-0001,
0002, 0003 and 0006 under `docs/architecture/adr/`.

## Where the code is

The layout is the one
`docs/architecture/adr/0002-architecture-style-and-repository-layout.md` (Accepted) sets
out: `packages/domain` (the rules) → `packages/application` (commands, queries, ports,
the request context and authorization) → `packages/adapters` (the DynamoDB and in-memory
stores, the catalog snapshot), with `packages/contracts` holding the HTTP schemas beside
them, and `apps/api` wiring adapters to the application. `apps/web` imports none of
them: it reaches the API over HTTP. A worker joins `apps/` when there is one. The edges
between them are `eslint.config.mjs`'s tables, asserted again by
`tests/boundaries.test.ts`; read them there.

Where an ADR is still Proposed, follow it and raise a disagreement in the pull request
rather than inventing a third shape. Values an ADR owns (a key layout, an endpoint list)
are read there, not restated here.

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

## Commands and queries

- A write is a **command**: plain data, validated at the edge, carrying the ids the
  client generated. Its handler loads the state it needs, calls a pure `decide` in the
  domain, and **commits** the resulting changes as one atomic conditional write whose
  conditions state what must still hold ("the round is open", "this answer id is new").
  A failed condition is re-run or answered with a domain error — never retried blindly.
- No port method brackets reads and writes around a caller's callback (a
  `transaction(body)`). DynamoDB has no interactive transaction, and a caller-held one
  hides the consistency boundary inside the caller. `LearnerStore.commit` in
  `packages/application/src/store.ts` is the shape instead: the writes, plus the
  versions each read must still hold.
- A read is a **query** answered from projections — item memory, learner totals —
  maintained on write, never by replaying the whole history per request.
- Append-only logs (answers, reviews) are what projections are rebuilt from. Keep them:
  fitting FSRS parameters, switching from Leitner to FSRS, and replaying an evaluation
  all need the history. Each entry keeps the state before and after and a snapshot of
  the item's metadata, as `AnswerRecord` does, so it outlives the item.
- Commands are data so that one command serves the HTTP API, a queued job and, later, an
  agent's tool, behind one authorization check.

## Idempotency

- A command that can be retried carries an identity the client made (an answer id, a
  round id) or an `Idempotency-Key`, and the commit's condition turns a repeat into a
  no-op that returns the first result. An answer whose client-made id a round already
  holds is skipped (`packages/domain/src/answers.ts`), and finishing a finished round
  answers with the summary it kept (`packages/application/src/finish-round.ts`).
- For non-deterministic work, such as a language-model grade, idempotency means storing
  the first result under the job's key and returning it — not expecting the same output
  twice.
- Offline clients send late. Accept an answer for an older round, take its day from the
  round, and bound a client timestamp by the round's start and the server's clock.

## Ports and contexts

- A port exists only where two or more real implementations do: the store (in-memory for
  tests, DynamoDB), the catalog (files in development, a build-time snapshot in
  production), the authenticator (Cognito, locally signed test tokens), the clock and
  ids; later language-model tasks, the job runner and the entitlements ledger. A pure
  rule is not a port — swap the function.
- Ports are async even where an implementation is synchronous.
- A context (identity, catalog, practice-composition, learning-record and the rest in
  ADR-0003) is a module with one surface. Another context is reached through that
  surface, and data it needs is passed or copied, never read from its storage.
- A consistency boundary decides what one commit may touch: a round with its answers, a
  day's portion, one item's memory, the settings, one ledger entry. A command that needs
  two is a sign it should be two commands.

## Deliberately not adopted

| Pattern                                                | Why not                                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Use-case interactor classes, presenters, per-layer DTO | A function per command or query already is the use case; copies between layers add no consumer |
| Entity classes, a repository per entity, value objects | Plain data and pure functions test more easily; branded types and zod carry the safety         |
| A domain event bus or a command bus framework          | Direct calls; an event appears only when an async consumer does, recorded in an ADR            |
| Full event sourcing                                    | Logs are kept only where history has a named use; everything else is state                     |
| Microservices                                          | One core behind several entry points; a single owner cannot run distributed operations         |

Adopting one needs an ADR naming the problem the current shape cannot solve.
**REQUIRED:** `recording-architecture-decisions`.

## Testing the shape

A `decide` function gets plain unit tests built from worked examples; a command runs
against the in-memory store; every store adapter runs the shared contract suite, whose
isolation half **REQUIRED:** `isolating-learner-data` owns. **BACKGROUND:**
`writing-tests` for how each case is written.
