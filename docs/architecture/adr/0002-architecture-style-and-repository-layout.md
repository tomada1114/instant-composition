# ADR-0002: Architecture style and repository layout

- Status: Accepted (2026-09-23)
- Date: 2026-09-23
- Deciders: the owner

## Context

[ADR-0001](0001-server-owned-logic-behind-one-api.md) puts every rule behind one API.
That raises two questions this ADR answers:

- Which of the usual architecture styles to adopt, and how far: Clean Architecture,
  ports and adapters, domain-driven design, CQRS, event sourcing.
- How to lay out the repository once the Next.js single-package app is split into an
  API, a web client and infrastructure code.

The current code already has several of the right properties, and they are worth
keeping:

- `src/core/` is framework-free and mostly pure. Deck composition, placement, streaks
  and the Leitner state (`src/core/card-state.ts:23-41`) are functions of their inputs.
- Dependencies point one way, `app → server → core`. This is enforced twice: by
  `no-restricted-imports` zone blocks in `eslint.config.mjs` and by
  `tests/boundaries.test.ts`.
- There is a single composition root (`src/server/composition.ts:25-39`), and the clock
  and id generator are injected through `ServiceDeps`
  (`src/server/services/deps.ts:4-9`).
- Two ports exist, the progress store and the content source.

What is missing:

- The learner's timezone. `dayOf` reads the server process's local time
  (`src/core/day.ts:25-32`), and a server's timezone is not the learner's.
- An application layer that owns authorization. Today services are called directly by
  pages and handlers.
- Package boundaries that a native-app-era API, a web client and CDK code can share.

The owner's preferences: depth over breadth, an architecture that can carry a 90-minute
design discussion, and a codebase that AI coding agents can work in safely.

## Decision drivers

- Adopt a pattern only where it pays for itself at this size, and be able to say why
  each one was not adopted further.
- Keep domain rules pure and testable without I/O.
- One obvious place for each concern, so both human and agent edits land in the right
  file.
- Boundaries that are checked mechanically, not just described.

## Considered options

Each style was considered at several depths. The table records the chosen depth and what
was left out.

| Style              | Adopted                                                                                                                                                                                                               | Not adopted, and why                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean Architecture | The dependency rule (inner layers name nothing outer) and a composition root per deployable.                                                                                                                          | Use-case interactor classes, presenters, output ports and DTO mapping at each ring. The domain is already plain functions over plain data; extra rings would add translation code with no second consumer.                                                  |
| Ports and adapters | Only at seams with at least two real implementations: store (DynamoDB, in-memory), catalog (snapshot file, local directory), authenticator (Cognito, test signer), clock and id. Later: LLM task, job runner, ledger. | Ports around pure logic such as the scheduler or the deck composer. What varies there is the algorithm, not I/O, so choosing a function is enough.                                                                                                          |
| DDD, strategic     | Bounded contexts as modules with public surfaces ([ADR-0003](0003-bounded-contexts-and-activity-integration.md)).                                                                                                     | One service per context ([ADR-0001](0001-server-owned-logic-behind-one-api.md), option C).                                                                                                                                                                  |
| DDD, tactical      | Aggregates only as consistency boundaries, used to decide what one conditional commit covers: a round, a day portion, an item's memory state, settings, the ledger.                                                   | Entity classes, per-aggregate repository objects, value-object classes, a domain event bus. Branded types and zod schemas give the same guarantees with less code.                                                                                          |
| CQRS               | CQRS-lite: commands are data; each is handled as load → decide (pure) → commit; reads come from projections kept up to date on write.                                                                                 | A separate read database and a command bus framework. The benefit sought is one entry shape for HTTP, queue workers and agent tools, and plain functions provide it.                                                                                        |
| Event sourcing     | Append-only answer and review logs, plus projections (item memory, learner totals) that can be rebuilt from them.                                                                                                     | Rehydrating every aggregate from events. The logs exist for three concrete reasons: FSRS parameter optimization, replaying history when the scheduler changes ([ADR-0003](0003-bounded-contexts-and-activity-integration.md)), and reproducing evaluations. |

## Decision

### Style

Adopt the depths in the table. The handling of every command has the same shape:

```ts
// packages/application — illustrative
type Handler<C, R, E> = (ctx: RequestContext, command: C) => Promise<Result<R, E>>;

// load: learner-bound reads through ports
// decide: pure function in packages/domain → { changes, events, result }
// commit: one atomic conditional write through the store port
```

`Result` (`src/core/result.ts`) stays the error channel for expected failures. A thrown
error still means a bug.

### Repository layout

Restructure this repository incrementally into a pnpm workspace:

```text
packages/
  domain/        pure rules moved from src/core: composition, placement, Leitner then
                 FSRS, streaks, levels; timezone-aware day arithmetic; Result
  application/   commands, queries, RequestContext, Actor, authorize(), port interfaces
  adapters/      dynamodb, catalog snapshot, cognito authenticator, clock/id;
                 later bedrock, sqs, ledger
  contracts/     zod request/response schemas → OpenAPI document → generated TS client
apps/
  api/           Hono HTTP adapter and the API Lambda entry (ADR-0007)
  web/           the static SPA (ADR-0008)
  worker/        queue consumers, added with the first asynchronous job (ADR-0011)
infra/           AWS CDK app (ADR-0009)
content/         catalog sources, unchanged in role (ADR-0004)
scripts/cards/   card tooling, later a workspace package of its own
```

Allowed dependencies:

```text
apps/*        → application, adapters, contracts
adapters      → application (ports), domain
application   → domain
contracts     → (zod only)
domain        → (nothing)
```

Boundaries are enforced three ways: each package's `dependencies` (a package that does
not declare another cannot import it), the existing ESLint `no-restricted-imports` zone
blocks extended to package paths, and `tests/boundaries.test.ts` rewritten to assert the
same edges over the workspace graph.

### Timezone

`RequestContext` carries the learner's IANA timezone and day-boundary hour. Every
day-keyed rule takes them as arguments. The process timezone is never read, so the same
answer lands on the same practice day whatever host runs the code.

### Why this suits AI-assisted development

- Seams are few and named. An agent adding a feature finds one command, one decide
  function and one adapter method to change, not a framework's conventions to infer.
- Pure `decide` functions are tested with plain values; no mocks are needed for the
  interesting logic.
- Package boundaries turn a wrong import into a failed install or lint, not a review
  comment.

## Consequences

### Positive

- The design vocabulary (context, command, decide, commit, projection) maps one-to-one
  onto directories and types, which makes design discussions concrete.
- Native-app work later touches `contracts` and nothing below it.
- The existing zone discipline and boundary test carry over instead of being replaced.

### Negative

- A workspace adds build and TypeScript project-reference configuration that a single
  package does not have.
- Projections duplicate data that the logs already hold, and they need rebuild tooling.
- Moving `src/core` into `packages/domain` touches every test import. This is
  mechanical, but it is a large diff.

### Follow-ups

- Rewrite AGENTS.md's Architecture section and the affected skills as each package
  lands. `building-app-routes` and `localizing-ui` are Next.js-specific today.
- Carry the per-file size budget and zone patterns from `eslint.config.mjs` into the new
  layout.

## Open questions

- Whether the Swift and Kotlin apps live in this repository (`apps/ios`, `apps/android`)
  or in their own. Keeping them here makes contract changes atomic; separate
  repositories keep toolchains apart.
- Whether `contracts` generates Swift and Kotlin clients in this repository's CI or only
  publishes the OpenAPI document
  ([ADR-0007](0007-http-api-contract-and-offline-sync.md)).

## Sources

No external facts are relied on beyond those cited in the related ADRs.

## Related

- [ADR-0001](0001-server-owned-logic-behind-one-api.md) — why a single API
- [ADR-0003](0003-bounded-contexts-and-activity-integration.md) — the modules
- [ADR-0006](0006-persistence-on-dynamodb.md) — the store port's shape
- [Current state](../current-state.md), [Roadmap](../roadmap.md)
