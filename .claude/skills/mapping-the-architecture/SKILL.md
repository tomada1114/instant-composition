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
  sends what the learner did; it never computes a deck, a schedule or a level. Rule
  values a client shows or applies arrive on that screen's response: the settings
  choices and focus cap, the home's deadline hour and talk length, a drill card's
  fast-flip threshold, and the opened talk's planned turn count.
- The web client is an ordinary API client with no private path into the code below the
  API. Authentication and authorization happen once, below the transport, so a second
  entry point (a job, a tool) would meet the same checks.
- The server is a modular monolith: one application core behind one API function.
  `apps/api`'s `createApp` takes every dependency as an argument; `main.ts` (`pnpm api`)
  and `lambda.ts` (hosted) wire it. No worker, queue or second deployable exists. Only
  the talk context calls a language model, through the `LanguageModel` port, once per
  step — and once at a kept talk's end, for card candidates — inside the request that
  asked; the drill calls none. The provider is OpenRouter, reached over HTTPS with the
  key from Parameter Store when hosted and from `API_OPENROUTER_API_KEY` locally; a
  local run with no key, and every test, gets a scripted stand-in. The edge wraps the
  model per request and logs one line per call, never its text (`serving-the-api`).

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

- One DynamoDB table, on-demand, one partition per learner, with TTL on `expiresAt`
  (epoch seconds) for records that should lapse, such as an abandoned talk. The key
  shapes are `packages/adapters/src/keys.ts`'s; the map today:

```text
LEARNER#<id>  PROFILE | SETTINGS | STATS            single records
LEARNER#<id>  ROUND#<round>                         a round
LEARNER#<id>  ROUND#<round>#ANSWER#<answer>         the review log, append-only
LEARNER#<id>  PORTION#<day> | DAY#<day>             a day's portion and tally
LEARNER#<id>  ITEM#<kind>#<item>                    an item's projection: composition or vocab
LEARNER#<id>  VOCAB#<session>                       a vocabulary session
LEARNER#<id>  VOCAB#<session>#ANSWER#<answer>       its answers, append-only
LEARNER#<id>  TALK#<talk>                           a talk with its turns and candidates; expiresAt until kept
LEARNER#<id>  CARD#<card>                           a personal vocabulary card, made from a talk
IDENTITY#<sub> LEARNER                              the identity mapping
```

- A talk is written with `expiresAt` beside its value while it is open or discarded, and
  without it once finished or ended, so only a talk never kept lapses. TTL deletes late,
  so the commands read a talk past its `expiresAt` as absent.
- Every id in a key is escaped with `encodeURIComponent`, so none reaches across a `#`.
  A round and its answers are one prefix `Query`, as are a vocabulary session and its
  answers, and each kind of item; there is no secondary index.
- Each command commits as one `TransactWriteItems`, puts conditioned on absence and
  updates and deletes on the version read — deleting a personal card with its progress
  is the one delete, and no commit updates or deletes a log entry; projections change in
  the same commit that appends to the log, so reads are point lookups. A vocabulary
  answer checks each personal card's version in that transaction and reloads its
  snapshot on conflict; deletion checks progress's version or continued absence. Deleted
  personal cards are skipped on a fresh answer load, while existing answer logs remain.
  Vocabulary answers use chunks of 32 so even a personal-card check per answer stays
  under the transaction limit. Answers commit per batch rather than all at `finish`,
  because one transaction holds at most `MAX_COMMIT_ITEMS` (`keys.ts`) actions and a
  long round with resends would not fit. The in-memory store and DynamoDB local run the
  same contract suite. **REQUIRED:** `designing-application-core` for the commit shape.
- Nothing migrates stored items. A field a record gains is optional and read with its
  default when absent; a field a type drops stays in old items, and both stores read
  settings, rounds, review details, item progress, talks and personal cards through the
  fields their types declare (`packages/adapters/src/declared.ts`), so it is neither
  returned nor written back.

## The HTTP contract

- `packages/contracts` states it as zod schemas and a route table of `/v1` paths under
  the `/api` root; the `/v1/auth/*` endpoints sit outside both. `openApiDocument()`
  builds OpenAPI 3.1 from zod's own JSON Schema output into the committed
  `packages/contracts/openapi.json`, which a test checks. `contracts` imports zod alone,
  so the contract never depends on the server framework.
- Errors are `{ error: { code, message } }`, `code` a string rather than an enum, and
  objects stay open (input-mode conversion): a client branches on `code` with a default
  branch and ignores unknown fields. Changes within `/v1` are additive, because an open
  tab on an older bundle, and the answers it queued, still meet the new API. A field
  leaves `/v1` only once no client reads it; request objects strip fields they do not
  name, so a queued body still carrying it is taken without it.
- The SPA's entry upload waits on the API function's update, so a new bundle that
  requires additive response fields is exposed only after the API serves them.
- Writes are safe to resend: rounds, vocabulary sessions and answers carry client-made
  ids, a repeated answer is skipped, and finishing a finished round or session returns
  its kept summary. A model's first answer — a scene, a turn, a talk's candidates — is
  stored and answered again; a candidate added twice is added once.
- A drill round adopts one first answer per card: a valid duplicate with another id
  succeeds without replacing the first committed grade or moving counters and FSRS
  again. The round version guards adoption and updates together; existing review logs
  supply the adopted cards, and remain unchanged. Retry answers retain separate ids and
  entries. The HTTP acknowledgement remains empty `204`, and reload/summary returns the
  adopted result. A finished round still rejects unrecorded ids.
- Answers travel in batches, so a live answer and a resent one take the same call; the
  web keeps unsent ones in the tab's `sessionStorage`. Only a contract status/code
  refusal drops an unsent answer: temporary and unknown responses stay pending. A
  `Retry-After` deadline is stored beside deferred answers, with old answer arrays still
  readable; no resend is made before it, and a failed attempt stops the drain. A finish
  also obeys that deadline and retains retry hints from its own response, and stops if
  any earlier batch was not acknowledged. A client `answeredAt` is clamped between the
  round's start and the server's time, a late answer counts for its round's day and
  never rewinds an item's schedule, and rounds never expire.

## The web client

A static SPA — Vite, React, TanStack Router and Query, use-intl over `messages/ja.json`
— served from S3 and calling the API on the same origin under `/api`, so the session
cookie needs no CORS. It has no server of its own, which is why server rendering or a
second data layer would be a new architecture rather than a feature. **REQUIRED:**
`building-web-screens`; the look is `designing-ui`'s.

Drill and vocabulary share the client-only `study/` session machine, re-asks, durable
answer queue, keyboard routing and navigation guard. Drill adds its timeout, fast
feedback, combo and placement adapter; vocabulary starts a study session directly
without drill timing configuration. Activity-specific card rendering, HTTP payloads and
finish calls stay in their own directories. The queue retains its existing storage keys
and answer format across reloads. The import graph keeps vocabulary out of drill
internals and keeps study independent of activities; scheduling remains on the server.

The talk's voice input is the one data flow that leaves the browser for a party other
than the API: Chrome's Web Speech API, in its default mode, sends the microphone's audio
to Google's speech service and hands the page text, which the client sends as typed text
would be. The app records no audio and adds no endpoint (`building-the-talk-activity`).

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
