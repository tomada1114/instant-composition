# ADR-0001: Server-owned logic behind one versioned API

- Status: Accepted
- Date: 2026-09-23
- Deciders: the owner

## Context

The application started as a single-learner Next.js App Router project that runs on a
laptop. Two paths reach the domain today:

- Pages are React Server Components that call the service layer in-process, for example
  `src/app/[locale]/(home)/page.tsx:26` calls `getServices().home()`.
- Mutations go through Route Handlers that are one-line re-exports
  (`src/app/api/answers/route.ts:1`) of Web-standard handlers
  (`(request: Request) => Promise<Response>`, `src/server/handlers/answers.ts:5-8`).

That shape was chosen to get a working drill quickly. The owner has since confirmed a
different future:

- Native apps will be built: Swift for iOS and macOS, Kotlin for Android. They come
  after the composition and vocabulary activities exist on the web, but they are treated
  as certain.
- Deck composition (which cards a round deals, in what mix) stays on the server. Clients
  should not need to know infrastructure details, and no rule is shared as code between
  TypeScript, Swift and Kotlin.
- Native apps queue answers while offline and send them later
  ([ADR-0007](0007-http-api-contract-and-offline-sync.md)).
- The service will be public, with self sign-up, and later with LLM features that cost
  money per call.

An earlier recommendation, made before the native-app requirement was known, was a
Next.js full-stack monolith on Lambda. This ADR replaces it.

## Decision drivers

- Four clients (web, iOS, macOS, Android) must see the same rules and the same
  authorization decisions.
- One place to enforce authentication, authorization and, later, the per-learner LLM
  allowance ([ADR-0010](0010-entitlements-and-billing.md)).
- A solo owner operates it: few deployables, near-zero idle cost, no always-on servers.
- The domain must stay testable without a framework, as it is today.
- The codebase is developed largely with AI coding agents, so each concern should have
  one obvious home and one way in.

## Considered options

### A. Next.js full-stack monolith on Lambda

Keep Next.js as both UI and domain host, and deploy it to Lambda.

- Two entry paths into the domain survive: Server Components calling services directly,
  and Route Handlers. Native apps would need a third, the API, so authorization is
  written or at least wired three times.
- Each web deploy is also a domain deploy. A styling change redeploys the API that
  native apps depend on.
- Amplify Hosting documents support for Next.js 12 through 15; this app is on
  `next ^16.3.4` (`package.json:83`), so the managed host is not an option today and a
  self-built Lambda setup would be needed anyway.

Rejected: the native-app requirement makes an API mandatory, and once it exists, a
second path into the domain is a liability.

### B. API-first modular monolith with thin clients (chosen)

One HTTP API, versioned (`/v1`), owns every rule. The web client and the native apps are
equal consumers of it. Internally it is one deployable split into modules
([ADR-0003](0003-bounded-contexts-and-activity-integration.md)), running as an API
Lambda, plus a worker Lambda once asynchronous jobs exist
([ADR-0011](0011-llm-integration-and-evaluation.md)).

### C. Separate services per context

Split identity, catalog, practice and learning record into separately deployed services.

- Every cross-context call becomes a network call with its own failure modes, retries
  and versioning.
- Deployment, monitoring and IAM multiply per service for one person.
- The contexts are not independently scaled or owned by different teams, which is the
  usual reason to pay that cost.

Rejected: the operational overhead buys nothing at this size.

### D. Agent-centric core on Amazon Bedrock AgentCore

Make a conversational agent the primary interface and expose features as MCP tools.

- The core activity is a timed drill (a card with a 6–20 second limit,
  `src/core/tuning.ts:12`). It is not a conversation, and putting a model call on that
  path adds latency and per-answer cost.
- The owner wants to use the application without any LLM for a while first.

Rejected as the core. Agents remain an option for features that genuinely need them
([ADR-0012](0012-agents-and-agentcore.md)).

## Decision

Adopt option B.

- All domain logic lives behind one versioned HTTP API. No client computes a deck, a
  schedule, a level or a streak; clients render what the API returns and send what the
  learner did.
- Every client is an API client, including the web. The web becomes a static single-page
  app ([ADR-0008](0008-web-client-as-static-spa.md)) and has no private path into the
  domain.
- The server is a modular monolith: one application core, deployed as one API Lambda now
  and a worker Lambda later. Both are built from the same packages
  ([ADR-0002](0002-architecture-style-and-repository-layout.md)).
- Authentication, authorization and allowance checks sit in the application layer, not
  in the HTTP adapter, so every entry point shares them
  ([ADR-0005](0005-identity-and-authorization.md)).

The request flow for every client:

```text
client (web SPA | Swift | Kotlin)
  → HTTPS /v1/...                      (ADR-0007, ADR-0009)
  → HTTP adapter (Hono): parse, authenticate → RequestContext
  → application: authorize(actor, command) → load → decide (pure) → commit
  → adapters: DynamoDB, catalog snapshot, clock, id
```

### Keeping extraction cheap

Option B is chosen partly because it does not close off C or D later:

- Commands and queries are plain data validated by zod schemas (for example
  `startRoundSchema`, `src/core/api.ts:14`). A command can arrive over HTTP, from a
  queue, or from an agent tool with no change to the code that handles it.
- Handlers keep today's Web-standard signature (`src/server/handlers/respond.ts`), so
  moving a route between Hono on Lambda, a worker, or another host is a wiring change.
- Contexts talk through their public module surfaces only. Promoting one of them to its
  own deployable later is a packaging exercise, not a rewrite.

## Consequences

### Positive

- One authorization path for four clients, testable with `new Request(...)` as today.
- Native apps get a contract they can generate clients from
  ([ADR-0007](0007-http-api-contract-and-offline-sync.md)) instead of
  reverse-engineering a web app.
- Web and API deploy independently. A UI change cannot break native clients.
- The domain stays framework-free, as `src/core/` already is.

### Negative

- The web loses in-process Server Component reads. Every screen is one or more API round
  trips, and the home screen has to be designed as an API query rather than a server
  render.
- A public API must stay backward compatible while old native builds are in use. That is
  a versioning discipline the web alone never needed.
- A static SPA plus an API is two deployables where the current app is one.

### Follow-ups

- Split the repository into packages and apps
  ([ADR-0002](0002-architecture-style-and-repository-layout.md)).
- Define the `/v1` contract, error vocabulary and offline rules
  ([ADR-0007](0007-http-api-contract-and-offline-sync.md)).
- Retire the Next.js server and `src/proxy.ts` once the SPA and the API cover every
  current screen ([roadmap](../roadmap.md)).

## Open questions

- Whether some web screens (a public landing page) need server rendering for search
  engines. They can be static pages outside the SPA; this is not decided.

## Sources

- Amplify Hosting SSR support (Next.js 12–15), AWS documentation, checked 2026-09-23:
  https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html
- Amplify Hosting compute supports Next.js 15:
  https://docs.aws.amazon.com/amplify/latest/userguide/update-app-nextjs-version.html

## Related

- [ADR-0002](0002-architecture-style-and-repository-layout.md) — packages and patterns
- [ADR-0003](0003-bounded-contexts-and-activity-integration.md) — module boundaries
- [ADR-0007](0007-http-api-contract-and-offline-sync.md) — the API contract
- [ADR-0008](0008-web-client-as-static-spa.md) — the web client
- [ADR-0012](0012-agents-and-agentcore.md) — where agents fit
- [Current state](../current-state.md), [Vision](../vision.md)
