# ADR-0013: OpenAPI generated from zod's own JSON Schema

- Status: Accepted (2026-09-23)
- Date: 2026-09-23
- Deciders: the owner
- Supersedes: the "OpenAPI generation is planned through hono-openapi" line of
  [ADR-0007](0007-http-api-contract-and-offline-sync.md), and closes its open question
  on whether hono-openapi or `@hono/zod-openapi` supports Zod v4. The rest of ADR-0007
  stands.

## Context

[ADR-0007](0007-http-api-contract-and-offline-sync.md) makes the HTTP contract a set of
zod schemas in `packages/contracts`, with an OpenAPI 3.1 document generated from them,
committed, and checked by a test that fails on an uncommitted difference. It planned the
generation through hono-openapi, which reads validation schemas attached to Hono routes,
and left open whether that library, or `@hono/zod-openapi`, supports Zod v4 — the only
zod this repository has (`zod ^4.5.4`, one copy in the workspace).

[ADR-0002](0002-architecture-style-and-repository-layout.md) gives `packages/contracts`
one allowed dependency: `contracts → (zod only)`. The Hono application (`apps/api`) does
not exist yet; it is the next Phase 1 work item and is to be built on these schemas.

Zod 4 converts a schema to JSON Schema itself:

- `z.toJSONSchema()` was introduced in Zod 4.0, and its default target is JSON Schema
  Draft 2020-12; the other targets are `draft-04`, `draft-07` and `openapi-3.0` (zod's
  JSON Schema documentation, checked 2026-09-23). The installed version is 4.5.4
  (`node_modules/zod/package.json`, checked 2026-09-23).
- Passed a registry instead of a schema, it converts every schema registered with an
  `id` and links them with `$ref`s, whose form its `uri` option sets (same source).
- In `io: "input"` mode it does not set `additionalProperties` on an object; in the
  default output mode a plain `z.object()` becomes `additionalProperties: false` (same
  source).
- An OpenAPI 3.1 Schema Object is a JSON Schema Draft 2020-12 schema (OpenAPI
  Specification 3.1.1, checked 2026-09-23). So zod's default output is already OpenAPI
  3.1's dialect; what is left is the document around it.

## Decision drivers

- No dependency beyond zod in `packages/contracts` (ADR-0002), and none added to the
  workspace for a job zod already does.
- The contract can be generated and checked before any server exists, and independently
  of how the server is built.
- A generated Swift or Kotlin client keeps working when `/v1` adds a response field
  (ADR-0007, "Versioning").
- The committed document shows every contract change as a readable diff.

## Considered options

1. **zod's `z.toJSONSchema()` for the schemas, and a small function in
   `packages/contracts` that assembles the document from a route table.**
2. hono-openapi, as ADR-0007 planned. The document is derived from the validators and
   descriptions attached to the Hono application's routes, so it cannot exist before
   `apps/api` does, and the contract package would stop being the place the contract is
   stated. Its Zod v4 support was the open question; it no longer needs answering.
3. `@hono/zod-openapi`. Routes are declared with its `createRoute()` and registered with
   `app.openapi()`, and `z` is imported from the package itself (Hono's Zod OpenAPI
   example, checked 2026-09-23), which binds the schemas to one server framework — the
   opposite of a contract a Swift or Kotlin client is generated from. Same open question
   on Zod v4.
4. A zod-to-OpenAPI package that is not tied to Hono. It would add a dependency whose
   remaining job, once zod emits Draft 2020-12 itself, is the assembly below: under two
   hundred lines of code this repository can own. Not evaluated further.
5. A hand-written document. ADR-0007 rules it out: the document is generated, never
   written by hand, so it cannot drift from the schemas the server validates with.

## Decision

Adopt option 1.

- `packages/contracts` holds the request and response schemas, the error envelope and
  its code-to-status table, and a route table: per operation its method, `/v1` path,
  operation id, request body, success status and body, and the error codes it may answer
  with. It imports zod and nothing else; `eslint.config.mjs` and
  `tests/boundaries.test.ts` hold that row, and its manifest declares zod at the root's
  own range.
- `openApiDocument()` builds the OpenAPI 3.1 document from the table. Paths are
  `/v1/...` and `servers` is `[{ "url": "/api" }]`, so a client calls `/api/v1/...`
  (ADR-0007). Every request and response body is a named component under
  `components.schemas`, converted in one registry pass with `$ref`s of the form
  `#/components/schemas/<Name>`; a body schema that is not named fails the build of the
  document rather than being inlined.
- Schemas are converted with `io: "input"`. That describes what the server accepts, and
  it leaves objects open: output mode would close every response object with
  `additionalProperties: false`, and a client generated from that could refuse a field
  `/v1` is allowed to add. The `$schema` and `$id` zod writes into each converted schema
  are dropped, since the document fixes the dialect and a component is placed by its
  key.
- The error envelope stays `{ error: { code, message } }`. `code` is a string in the
  schema, not an enum of today's codes, because new codes may appear within `/v1`; each
  operation's error responses are grouped by status, and each response's description
  names the codes it carries.
- Response schemas mirror `packages/application`'s view types. Because the package may
  not import the application, `tests/contracts-schemas.test.ts` holds each schema to the
  view it serves at compile time, in both directions, and parses what the commands and
  queries actually return through a day of practice.
- The document is committed as `packages/contracts/openapi.json`, formatted by Prettier.
  `tests/contracts-openapi.test.ts` regenerates it and compares it with the file through
  Vitest's `toMatchFileSnapshot`. Vitest writes no snapshot when `CI` is set, so in CI a
  changed or missing document fails the run (Vitest's snapshot guide, checked
  2026-09-23); `pnpm contracts:openapi` is the one command that rewrites the file.
- Two request shapes settle here. An answer in a batch carries no `roundId`, which the
  path names, and no client time: the server stamps `answeredAt` until the offline queue
  (ADR-0007) adds a bounded client time. `POST /v1/rounds` carries the client-made
  `roundId` ADR-0007 decided on.

## Consequences

### Positive

- No new dependency, and the contract is generated from the package that states it,
  before and independently of the server.
- The server built in `apps/api` validates with the same schemas the document is made
  from, so the two cannot disagree.
- A contract change is a diff to `openapi.json` in the same pull request, and cannot
  land without one.

### Negative

- The assembler is this repository's to maintain. Anything OpenAPI can say beyond what
  it writes today — a security scheme, a header such as `Idempotency-Key`, examples, a
  `discriminator` on the tagged unions — is an edit to it rather than a library option.
- The compile-time check between a schema and its view type cannot see an optional field
  the schema declares and the view never has; the runtime parse covers only the fields
  the exercised paths produce.

### Follow-ups

- `apps/api` (issue #39) serves these routes with Hono and validates with these schemas.
  `GET /v1/rounds/{roundId}/summary` needs a query by round id: today's `recap` reads
  only the day's last finished round.
- The Cognito security scheme joins the document with learner registration (Phase 3),
  and a bounded client `answeredAt` with the offline answer queue (Phase 5).

## Open questions

- Unverified: whether the Swift and Kotlin client generators ADR-0007 names need a
  `discriminator` on the `oneOf` unions (`HomeState`, `StreakView`, `TitleGroup`) to
  generate usable types. zod writes `oneOf` with a `const` tag on each member and no
  `discriminator`.

## Sources

- Zod, JSON Schema, checked 2026-09-23: https://zod.dev/json-schema
- OpenAPI Specification 3.1.1, checked 2026-09-23:
  https://spec.openapis.org/oas/v3.1.1.html
- Vitest, Snapshot, checked 2026-09-23: https://vitest.dev/guide/snapshot
- Hono, Zod OpenAPI, checked 2026-09-23: https://hono.dev/examples/zod-openapi

## Related

- [ADR-0002](0002-architecture-style-and-repository-layout.md): `contracts → (zod only)`
- [ADR-0007](0007-http-api-contract-and-offline-sync.md): the contract this document
  describes
- [References](../references.md)
