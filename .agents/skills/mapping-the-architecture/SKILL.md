---
name: mapping-the-architecture
description: >
  Covers the architecture this app runs on today and the patterns it adopted: rules
  owned by one /v1 HTTP API, the layering, bounded contexts as modules, the content
  model and catalog snapshot, identity and learner-bound stores, the DynamoDB single
  table, the OpenAPI contract generated from zod, the static SPA, and the dev AWS
  topology. Use when a change moves a context boundary, a persistence shape, the HTTP
  contract, a provider or AWS service, or the security model; when weighing a new layer,
  service, client or pattern; or when asking why the system is shaped as it is.
---

# Mapping the Architecture

**Owns:** the map of the system as built — which pieces exist, how they connect, which
patterns are adopted at the system level and which are deliberately not, and the rule
that keeps this map current. **Does not own:** the shape of domain and application code
(`designing-application-core`); the HTTP edge's handlers, log line and environment
(`serving-the-api`); credentials, cookies and sign-in (`authenticating-learners`); who
may reach whose data (`isolating-learner-data`); screens and API calls in the web client
(`building-web-screens`); how `infra/` expresses each resource
(`writing-infrastructure`). This skill names where a thing lives and why; the sibling
owns how to change it.

## One API owns every rule

- Every rule — which cards a round deals, the schedule, the level, the streak — runs on
  the server behind one versioned HTTP API. A client renders what the API returns and
  sends what the learner did; it never computes a deck, a schedule or a level.
- The web client is an ordinary API client with no private path into the code below the
  API. Authentication and authorization happen once, below the transport, so a second
  entry point (a job, a tool) would meet the same checks.
- The server is a modular monolith: one application core behind one API function.
  `apps/api`'s `createApp` takes every dependency as an argument; `main.ts` (`pnpm api`)
  and `lambda.ts` (hosted) wire it. No worker, queue or second deployable exists, and no
  language model is called at runtime.

## Layers and contexts

The workspace, its packages and the one-way import rule are AGENTS.md's "Architecture"
section, enforced by `eslint.config.mjs` and `tests/boundaries.test.ts`; read them
there. The domain names nothing outward, which is what let it outlive the framework it
was first written under.

The bounded contexts are modules inside those packages, not packages or services of
their own:

| Context              | What it holds                                                | Where it lives                                                                                              |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| identity             | `sub` → internal `LearnerId`, the learner's profile          | `LearnerDirectory` (`sign-in.ts`), `profile.ts`; the two directory adapters                                 |
| catalog              | cards, topics, levels and grammar concepts, read-only        | the `Catalog` port (`catalog.ts`, `catalog-document.ts`); `snapshotCatalog`; `scripts/catalog/build.mjs`    |
| practice-composition | rounds, day portions, placement, level, deck composition     | domain's `compose*`, `deck`, `start*`, `placement`, `difficulty`; application's round and settings commands |
| learning-record      | the append-only review log and each item's memory projection | domain's `records.ts` and `card-state.ts`                                                                   |
| learner-model (v0)   | weak grammar concepts and subtopics                          | domain's `weakness.ts`, derived when read                                                                   |

- Streak, points and titles live inside practice-composition while it is the one
  activity. Items cross contexts only as an `ItemRef` (`kind` plus `id`), so a second
  activity adds a `kind` rather than changing composition.
- The learner model stores nothing: it is a pure pass over item projections the reads
  already load. Grammar weaknesses feed the deck; subtopic weaknesses are only shown.
- Scheduling is Leitner boxes. Each review logs a common outcome (`again`, `good`,
  `easy`) with the memory state before and after, so a scheduler change is a replay.

How a context exposes its surface: **REQUIRED:** `designing-application-core`.

## Content and the catalog snapshot

- Cards live under `content/` and change only through `pnpm cards:*` (AGENTS.md
  "Content", and the card skills). A card is shown only while its review stamp matches
  its fields.
- `pnpm catalog:build` turns `content/` into one snapshot per language pair,
  `dist/catalog/<target>/<l1>.json`, versioned by a content hash. The snapshot is
  target-anchored: an item is the target-language sentence with its alternatives, level
  and concept ids namespaced by the target (`en:grammar/<id>`), and the prompt and
  explanation are per-L1 localizations. One pair exists, `en` from `ja`.
- Stamps are resolved at build time, so unreviewed text never leaves the build. An
  edited card ships as `withdrawn` (no text), a deleted one as a tombstone with its
  prompt, so an answer naming either still resolves; each review entry also snapshots
  the item, so the log outlives the card.
- The API reads the snapshot file through the `Catalog` port. `pnpm dev` builds it
  locally, and a deploy bundles it into the function, so code and content release
  together. UI strings stay in `messages/`; content text arrives from the API.

## Identity and authorization

- Amazon Cognito authenticates. The API verifies the access token itself, not API
  Gateway, so the Bearer header and the web session cookie share one verification path.
- The web runs a backend-for-frontend inside the API: `/api/v1/auth/*` runs the code
  flow with PKCE against a confidential client and keeps tokens in HttpOnly cookies, so
  no token is readable by page scripts. **REQUIRED:** `authenticating-learners` for the
  endpoints, cookies, the local stand-in and its conditions.
- Cognito's `sub` maps to an internal `LearnerId`, registered with a default profile on
  first sign-in. Data keys carry the `LearnerId`, so a new identity provider never
  rewrites them. The profile is the application's own record, not Cognito attributes.
- The edge builds one `RequestContext` per request. Stores are reached only as
  `stores.forLearner(id)`, and `authorize(actor, operation)` is one table over the
  `learner`, `system` and `agent` actor kinds; only learners act today. **REQUIRED:**
  `isolating-learner-data` before touching any of it.

## Persistence

- One DynamoDB table, on-demand, one partition per learner. The key shapes are
  `packages/adapters/src/keys.ts`'s; the map today:

```text
LEARNER#<id>  PROFILE | SETTINGS | STATS            single records
LEARNER#<id>  ROUND#<round>                         a round
LEARNER#<id>  ROUND#<round>#ANSWER#<answer>         the review log, append-only
LEARNER#<id>  PORTION#<day> | DAY#<day>             a day's portion and tally
LEARNER#<id>  ITEM#<kind>#<item>                    an item's memory projection
IDENTITY#<sub> LEARNER                              the identity mapping
```

- Every id in a key is escaped with `encodeURIComponent`, so none reaches across a `#`.
  A round and its answers are one prefix `Query`; there is no secondary index.
- Each command commits as one `TransactWriteItems`, puts conditioned on absence and
  updates on the version read; projections change in the same commit that appends to the
  log, so reads are point lookups. Answers commit per batch rather than all at `finish`,
  because one transaction holds at most `MAX_COMMIT_ITEMS` (`keys.ts`) actions and a
  long round with resends would not fit. The in-memory store and DynamoDB local run the
  same contract suite. **REQUIRED:** `designing-application-core` for the commit shape.

## The HTTP contract

- `packages/contracts` states it as zod schemas and a route table of `/v1` paths under
  the `/api` root; the `/v1/auth/*` endpoints sit outside both. `openApiDocument()`
  builds OpenAPI 3.1 from zod's own JSON Schema output into the committed
  `packages/contracts/openapi.json`, which a test checks. `contracts` imports zod alone,
  so the contract never depends on the server framework.
- Errors are `{ error: { code, message } }`, `code` a string rather than an enum, and
  objects stay open (input-mode conversion): a client branches on `code` with a default
  branch and ignores unknown fields. Changes within `/v1` are additive, because an open
  tab on an older bundle, and the answers it queued, still meet the new API.
- Writes are safe to resend: rounds and answers carry client-made ids, a repeated answer
  is skipped, and finishing a finished round returns its kept summary.
- Answers travel in batches, so a live answer and a resent one take the same call; the
  web keeps unsent ones in the tab's `sessionStorage`. A client `answeredAt` is clamped
  between the round's start and the server's time, a late answer counts for its round's
  day and never rewinds an item's schedule, and rounds never expire.

## The web client

A static SPA — Vite, React, TanStack Router and Query, use-intl over `messages/ja.json`
— served from S3 and calling the API on the same origin under `/api`, so the session
cookie needs no CORS. It has no server of its own, which is why server rendering or a
second data layer would be a new architecture rather than a feature. **REQUIRED:**
`building-web-screens`; the look is `designing-ui`'s.

## The dev AWS topology

```text
browser ─► CloudFront (flat-rate Free plan, WAF web ACL from `edge`)
             ├─ /*      ─► S3 SPA bucket (origin access control)
             └─ /api/*  ─► API Gateway HTTP API ─► Lambda: the Hono app via lambda.ts
                                                     ├─► DynamoDB learner table
                                                     ├─► Cognito user pool
                                                     └─► Parameter Store (client secret)
```

- One AWS account, `ap-northeast-1`, except the web ACL CloudFront takes from us-east-1
  alone. Nothing runs in a VPC, so nothing is billed by the hour while idle.
- `/api/*` reaches API Gateway, not a Function URL: origin access control on a Function
  URL would make every client send a body hash on `POST`, putting AWS in the contract.
- Four CDK stacks: `foundation` (table and user pool, retained), `edge`, `app`
  (everything rebuilt often, alarms included) and `deploy-access` (GitHub OIDC). `app`
  reads `foundation` by Parameter Store name, never by export. A merge to `main` deploys
  through OIDC; no long-lived key exists.
- An AWS Budgets action attaches a deny policy for Bedrock invocation to the API
  function's role once the month's Bedrock or Marketplace spend reaches its limit
  (`infra/src/bedrock-budget.ts`): an account-level backstop, since nothing calls
  Bedrock today.
- The CDK app's `stage` context accepts `dev` and `prod`; only `dev` is deployed.
- **REQUIRED:** `writing-infrastructure` for every construct, stage setting and deploy.
  Caller throughput limits belong at the edge: AGENTS.md "Rate limiting".

## Deliberately not adopted

| Pattern                                        | Why not                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A service per context, microservices           | Every cross-context call would become a network failure mode for one operator             |
| A web server of its own (server rendering)     | Behind sign-in it buys nothing, and it would be a second place requests are authenticated |
| A model or an agent on the drill's path        | The drill is timed; a model call adds latency and per-answer cost                         |
| A VPC, NAT gateway or always-on compute        | Hourly cost with no idle use                                                              |
| GraphQL, gRPC, or an OpenAPI tool tied to Hono | A few fixed commands over REST; the contract must not depend on the server framework      |
| A relational database                          | The partition per learner is what isolation follows from; no VPC or connection to manage  |

Code-level patterns not adopted (interactor classes, entity classes, buses, full event
sourcing) are `designing-application-core`'s table.

## Keeping this current

There are no ADRs and no roadmap. This skill is the record of the architecture as it
stands, so a pull request that moves a context boundary, changes a persistence shape or
key, changes the HTTP contract's rules, adds or replaces a provider or AWS service, or
changes the security model updates this skill in the same pull request, saying why in
present tense. Write what is true now, never history, dates or plans; a value a config
or a source file owns is named by its file, not copied. Then run `pnpm agents:sync`.
**BACKGROUND:** `authoring-skills`.
