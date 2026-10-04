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

## Read the current map before changing it

The [current architecture](references/architecture.md) records the running contexts,
content model, persistence, external contract, and AWS topology. Read the relevant
section before changing one of those seams, then update that reference in the same PR.

The [bounded vocabulary read models](references/read-models.md) reference owns candidate
ordering, source consistency, independent day preparation, and migration/catalog
cutover. Read it before changing those persisted families, worker, or readiness
response.

The [continuous paged vocabulary sessions](references/vocab-pages.md) reference owns
immutable deck preparation, continuation and offline ordering, bounds, and indefinite
replay of already saved legacy sessions.

The packages, domain contexts, and practice/vocabulary interactions are mapped in
[Runtime contexts](references/runtime-contexts.md).

## Content and the catalog snapshot

- Cards live under `content/` and change only through `pnpm cards:*` (AGENTS.md
  "Content", and the card skills). A card is shown only while its review stamp matches
  its fields.
- `pnpm catalog:build` turns `content/` into one snapshot per language pair,
  `dist/catalog/<target>/<l1>.json`, versioned by a content hash. The snapshot is
  target-anchored: an item is the target-language sentence with its alternatives, level
  and concept ids namespaced by the target (`en:grammar/<id>`), and the prompt and
  explanation are per-L1 localizations. One pair exists, `en` from `ja`.
- Vocabulary cards (`content/vocab/`) ride in the same per-pair snapshot as `vocab`:
  each reviewed card with its meaning in that pair's L1, and nothing of a card that has
  none. The adapter reads a snapshot without `vocab` as one holding none.
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
  no token is readable by page scripts. Cookie renewal is shared per tab and serialized
  with logout across tabs through Web Locks; a browser without locks cannot renew
  automatically. A refused renewal preserves cookies and probes the current credential;
  unavailable renewal keeps answers queued. **REQUIRED:** `authenticating-learners` for
  the endpoints, cookies, the local stand-in and its conditions.
- Cognito's `sub` maps to an internal `LearnerId`, registered with a default profile on
  first sign-in. Data keys carry the `LearnerId`, so a new identity provider never
  rewrites them. The profile is the application's own record, not Cognito attributes.
- The edge builds one `RequestContext` per request. Stores are reached only as
  `stores.forLearner(id)`, and `authorize(actor, operation)` is one table over the
  `learner`, `system` and `agent` actor kinds; only learners act today. **REQUIRED:**
  `isolating-learner-data` before touching any of it.

## Read models

Bounded vocabulary and learner queries are mapped in
[Read models](references/read-models.md) and
[Composition read models](references/composition-read-models.md).

## Persistence

The storage history, family keys, claim recovery, and paused deployment protocol are
mapped in [Storage and deployment](references/storage-and-deployment.md).

## The HTTP contract

The versioned HTTP contract, generated client, and browser runtime are mapped in
[HTTP and web](references/http-and-web.md).

## The dev AWS topology

```text
browser ─► CloudFront (flat-rate Free plan, WAF web ACL from `edge`)
             ├─ /*      ─► S3 SPA bucket (origin access control)
             └─ /api/*  ─► API Gateway HTTP API ─► Lambda: the Hono app via lambda.ts
                                                     ├─► DynamoDB learner table
                                                     ├─► Cognito user pool
                                                     ├─► Parameter Store (client secret, model key)
                                                     └─► OpenRouter (talk model calls, HTTPS)
```

- One AWS account, `ap-northeast-1`, except the web ACL CloudFront takes from us-east-1
  alone. Nothing runs in a VPC, so nothing is billed by the hour while idle.
- `/api/*` reaches API Gateway, not a Function URL: origin access control on a Function
  URL would make every client send a body hash on `POST`, putting AWS in the contract.
- Four CDK stacks: `foundation` (table and user pool, retained), `edge`, `app`
  (everything rebuilt often, alarms included) and `deploy-access` (GitHub OIDC). `app`
  reads `foundation` by Parameter Store name, never by export. Successful CI for the
  exact trusted `main` SHA gates automatic OIDC deployment of a fixed assembly;
  superseded main completions are skipped before AWS credentials. The API bundle's
  read-only `/api/release` verifies packaged code/catalog hashes, and post-deploy
  CloudFront smoke checks that identity, web bytes, a SPA route and the unauthenticated
  contract. No model call or learner mutation runs in that smoke. No long-lived key
  exists.
- The function's timeout is 25 s, under API Gateway's and CloudFront's 30 s, because a
  talk turn waits on two model calls. The talk routes, `/api/v1/talks` and below, are
  throttled on the HTTP API's stage at 2 requests per second, burst 10, since each turn
  bills the model provider.
- An AWS Budgets action attaches a deny policy for Bedrock invocation to the API
  function's role once the month's Bedrock or Marketplace spend reaches its limit
  (`infra/src/bedrock-budget.ts`): an account-level backstop, since nothing calls
  Bedrock today.
- The CDK app's `stage` context accepts `dev` and `prod`; only `dev` is deployed.
- **REQUIRED:** `writing-infrastructure` for every construct, stage setting and deploy.
  Caller throughput limits belong at the edge or the gateway, never in the app:
  AGENTS.md "Rate limiting".

## Deliberately not adopted

| Pattern                                        | Why not                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A service per context, microservices           | Every cross-context call would become a network failure mode for one operator             |
| A web server of its own (server rendering)     | Behind sign-in it buys nothing, and it would be a second place requests are authenticated |
| A model or an agent on the drill's path        | The drill is timed; a model call adds latency and per-answer cost                         |
| A model choosing a talk's next step            | The server fixes the step order; a model that chose it would be an agent loop to bound    |
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
