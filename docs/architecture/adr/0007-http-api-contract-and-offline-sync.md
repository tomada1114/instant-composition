# ADR-0007: HTTP API contract and offline answer sync

- Status: Accepted (2026-09-23); the OpenAPI generation line under "Framework" and the
  open question on Zod v4 are superseded by
  [ADR-0013](0013-openapi-generated-from-zod-json-schema.md)
- Date: 2026-09-23
- Deciders: the owner

## Context

[ADR-0001](0001-server-owned-logic-behind-one-api.md) puts all practice logic behind one
API. That API will serve four clients: the web SPA
([ADR-0008](0008-web-client-as-static-spa.md)), an iOS/macOS app written in Swift, and
an Android app written in Kotlin. The native apps come later, but they are certain, so
the contract has to be something a Swift or Kotlin client can be generated from. The
clients should not need to know how the server is hosted.

Today's surface was built for one browser on one machine:

- Five Route Handlers, each a one-line re-export (`src/app/api/answers/route.ts:1`):
  - `POST /api/rounds { kind }` starts a round or resumes today's open one
    (`src/server/handlers/rounds.ts:4`).
  - `POST /api/answers` stores one answer (`src/server/handlers/answers.ts:4`).
  - `POST /api/rounds/finish` takes in every answer and closes the round
    (`src/server/handlers/finish.ts:4`).
  - `PUT /api/settings` (`src/server/handlers/settings.ts:4`).
  - `GET /api/history` (`src/server/handlers/history.ts:3`).
- The home, records, recap and settings screens are read by Server Components that call
  services in-process (`src/app/[locale]/(home)/page.tsx:26`). No HTTP endpoint exists
  for them, so a native app has nothing to call.
- Request bodies are zod schemas shared with the browser code (`src/core/api.ts:16-33`).
  Every failure carries `{ error: { code, message } }` (`src/server/http.ts:27-34`), and
  each `ERR_*` code maps to a status in one table
  (`src/server/handlers/respond.ts:12-18`).
- Some idempotency exists already:
  - The client makes each answer's id (`src/core/types.ts:41-42`), and a repeated id is
    ignored (`src/server/db/answers.ts:49`).
  - A finished round answers with its saved summary
    (`src/server/services/finish.ts:133-135`).
  - Starting a round resumes today's open round of the same kind
    (`src/server/services/start.ts:150-153`).

The owner decided that native apps queue answers while offline and send them later.
Decks are fetched while online.

## Decision drivers

- A Swift or Kotlin client can be generated from the contract, with no hand-kept copy.
- A released native app keeps working for weeks after the server changes, because app
  stores and learners do not update on the day a change ships.
- The server stays the only place that composes decks and decides scheduling. Clients
  render and record; they do not re-implement rules.
- A resent or late request must be safe. Mobile networks retry, and an offline queue
  replays.
- The contract says nothing about hosting: no AWS headers, no signing requirements.
- The framework keeps today's Web-standard handler seam, so a handler stays testable
  with `new Request(…)` (see AGENTS.md, "The seams").

## Considered options

1. **REST + JSON, OpenAPI 3.1 generated from the zod schemas, served by Hono.**
2. REST served by NestJS. It is mature, but its decorator-driven dependency injection is
   a second composition model next to the explicit composition root this codebase uses.
   It also adds boilerplate an AI coding agent must reproduce exactly.
3. REST served by Fastify. It is mature and schema-first, but its request and response
   objects are not the Web `Request`/`Response`, so today's handler seam would have to
   be wrapped or rewritten.
4. GraphQL on AWS AppSync. Clients can be generated from it, but the drill's interaction
   is a few fixed commands, not an open query graph. It adds a schema language, a
   resolver model and a caching story that the problem does not need.
5. gRPC or Connect. Binary contracts generate well for Swift and Kotlin, but browser
   support needs a proxy or the Connect protocol. It is also further from the plain HTTP
   tooling this repository tests against.
6. Keep Next.js Route Handlers as the API. The API would be deployed with the web
   client, and reads would stay split between RSC calls and HTTP. ADR-0008 retires
   Next.js, which removes this option anyway.

## Decision

Adopt option 1.

**Contract.**

- The zod schemas move from `src/core/api.ts` into `packages/contracts`
  ([ADR-0002](0002-architecture-style-and-repository-layout.md)).
- The OpenAPI 3.1 document is generated from them, never written by hand, and is
  committed so that a diff shows every contract change.
- Clients are generated from the document:
  - The web SPA gets a TypeScript client.
  - Swift and Kotlin clients are generated per app (see Open questions for the
    generators).

**Versioning.**

- Paths are versioned with a `/v1` prefix. Paths in this ADR are relative to the API
  root, which is `/api` on the shared origin
  ([ADR-0009](0009-aws-topology-environments-and-operations.md)), so a client calls
  `/api/v1/rounds`.
- Within a major version, changes are additive only: new endpoints, new optional request
  fields, new response fields that clients must ignore when unknown.
- A removal or a change in meaning ships as `/v2`. `/v1` keeps working through a
  deprecation window that is long enough for store-distributed apps to update. The
  window's length is set when the first native app ships.
- Clients branch on `error.code`, never on `message`. New codes may appear within a
  major, so every client needs a default branch.

**Errors.** Keep the `{ error: { code, message } }` envelope and the `ERR_*` vocabulary.
Add codes only through the `designing-errors` conventions.

**First endpoint sketch** (derived from today's routes and screens; names settle during
implementation):

```text
GET    /v1/me                          learner profile: L1, target language, timezone, UI locale
PATCH  /v1/me                          change profile fields
GET    /v1/settings                    practice settings (topics, focus, daily size, sound)
PATCH  /v1/settings                    today's PUT /api/settings, as a partial update
GET    /v1/home                        the home view (today's portion, streak, next action)
POST   /v1/rounds                      { kind } → the round and its deck; resumes an open round of that kind
GET    /v1/rounds/{roundId}            a round and the answers already recorded (resume, prefetch)
POST   /v1/rounds/{roundId}/answers    a batch of answers; ids already stored are ignored
POST   /v1/rounds/{roundId}/finish     closes the round; a finished round returns its saved summary
GET    /v1/rounds/{roundId}/summary    the recap view
GET    /v1/records                     the records view
GET    /v1/history                     today's GET /api/history, for the card-planning tooling
```

The answer endpoint takes a batch rather than one answer, so the online path and the
offline replay use the same call.

**Idempotency.**

- Answers keep client-generated ids. Round creation should also accept a
  client-generated id, so a retried `POST /v1/rounds` cannot open two rounds. This is
  decided here but not yet built.
- Any other create that has no natural id accepts an `Idempotency-Key` header. The
  server stores the first response under that key and replays it.
- Finishing is already idempotent by design and stays so.

**Offline answer sync (Accepted).**

- While online, a client fetches its round, and it may prefetch today's round. Deck
  composition never runs on a client.
- Answers made offline are queued with their client ids and a client `answeredAt`. They
  are sent later through the batch endpoint.
- The server accepts `answeredAt` only between the round's `startedAt` and the server's
  current time. Outside that range it clamps the value. Today the server stamps
  `answeredAt` itself (`src/server/services/answer.ts:66`); the change is needed because
  the replay order drives scheduling.
- Late answers count toward the round's day, not the arrival day. This keeps today's
  rule that a round belongs to the day it started on
  (`src/server/services/answer.ts:47-51`).
- An abandoned round still accepts answers, and they still count. Today an open round is
  abandoned when another kind starts (`src/server/services/start.ts:133`), but it is
  never rejected for being abandoned.

**Localization.**

- Content in responses (prompts, explanations, topic names) arrives in the learner's L1,
  resolved from `/v1/me`.
- UI strings stay in each client's own catalogs. The API does not render UI text.

**Framework.**

- Hono, because its handlers take a Web `Request` and return a `Response`. Today's
  handler factories keep their shape.
- `hono/aws-lambda`'s `handle()` adapts the same app to Lambda
  ([ADR-0009](0009-aws-topology-environments-and-operations.md)).
- OpenAPI generation is planned through hono-openapi, which reads validation schemas
  attached to routes.

## Consequences

### Positive

- One generated contract serves all four clients, and the committed OpenAPI diff makes
  every contract change reviewable in a pull request.
- Offline replay needs no new mechanism. It is the online path with a delay, built on
  idempotency that already exists.
- Handlers remain framework-free functions, so tests keep driving them with
  `new Request(…)`.

### Negative

- Read views that are in-process RSC calls today (home, records, recap) become endpoints
  with a contract to maintain.
- The additive-only rule makes naming mistakes permanent until the next major. Contract
  review has to happen before release, not after.
- Client-supplied `answeredAt` must be trusted within bounds. A learner can skew their
  own schedule, but nobody else's, because every write is bound to the calling learner
  ([ADR-0005](0005-identity-and-authorization.md)).

### Follow-ups

- Move the request schemas into `packages/contracts` and add response schemas, which do
  not exist today.
- Add a contract test that regenerates the OpenAPI document and fails on an uncommitted
  diff.
- Decide how long `/v1` stays supported after `/v2` ships, before the first native
  release.

## Open questions

- Unverified: whether hono-openapi (or `@hono/zod-openapi`) supports Zod v4, which this
  repository uses (`zod ^4.5.4`). The documented examples import a Zod v3 extension.
- Unverified: whether Apple's `swift-openapi-generator` fits the Swift client, and
  whether OpenAPI Generator fits the Kotlin client. Both are candidates, not yet
  evaluated.
- Whether a round needs a server-side expiry for queued answers. For example, how many
  days late an answer may arrive and still count.
- Whether native apps prefetch more than today's round. Multi-day prefetch would have
  the server deal decks ahead of time, which interacts with the daily portion rules.

## Sources

- Hono on AWS Lambda (`handle()` from `hono/aws-lambda`), checked 2026-09-23:
  https://hono.dev/docs/getting-started/aws-lambda
- hono-openapi (OpenAPI from route validators), checked 2026-09-23:
  https://github.com/rhinobase/hono-openapi

## Related

- [ADR-0001](0001-server-owned-logic-behind-one-api.md): why logic sits behind one API
- [ADR-0005](0005-identity-and-authorization.md): how each request is bound to a learner
- [ADR-0006](0006-persistence-on-dynamodb.md): conditional writes behind idempotency
- [ADR-0008](0008-web-client-as-static-spa.md): the first client of this contract
- [ADR-0009](0009-aws-topology-environments-and-operations.md): where the API runs
- [References](../references.md)
