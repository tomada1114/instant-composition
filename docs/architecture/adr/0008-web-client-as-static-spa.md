# ADR-0008: Web client as a static SPA

- Status: Accepted (2026-09-23); the router, data-fetching and i18n libraries are chosen
  when the port starts
- Date: 2026-09-23
- Deciders: the owner

## Context

The application is a Next.js App Router app (`next ^16.3.4`, `package.json:83`). The
choice was made because it was quick for local experiments; the owner has no attachment
to it. The owner wants the stack that is best for the product and also easiest for AI
coding agents to work in.

How the current code divides between server and client:

- Pages are Server Components that call services in-process and hand the resulting view
  to a component (`src/app/[locale]/(home)/page.tsx:26`).
- Almost everything the learner interacts with is a client component: the drill, its
  timer, keys, sound, motion and summary screens under `src/components/`.
- Mutations already go through `fetch` to JSON endpoints
  (`src/components/lib/api.ts:14-24`).

[ADR-0001](0001-server-owned-logic-behind-one-api.md) makes every client an API client,
and the Swift and Kotlin apps will hold no server code. Under that decision the web
client's server half has no job left:

- Its reads become calls to `/v1/home`, `/v1/records` and so on
  ([ADR-0007](0007-http-api-contract-and-offline-sync.md)).
- Authentication lives in the API ([ADR-0005](0005-identity-and-authorization.md)).

## Decision drivers

- The web client should be one client among four, not a second backend.
- Static hosting has no server to run, patch or pay for.
- The "instrument" design lock, the Tailwind v4 tokens and the shadcn/ui components are
  settled and must carry over unchanged (see the `designing-ui` skill).
- Fewer framework rules for an AI coding agent to get wrong. The server/client component
  boundary, `"use client"` placement and the proxy matcher trap (`src/proxy.ts:20-36`)
  are all Next.js-specific failure modes.
- The app sits behind sign-in, so crawlers never see its screens.

## Considered options

1. **Static SPA: Vite + React + TypeScript, served from S3 behind CloudFront.**
2. Keep Next.js as a server-rendering web tier (a BFF) in front of the API. Hosting it
   takes a server:
   - Amplify Hosting documents Next.js 12–15 support, and this app is on 16.
   - Otherwise it runs on Lambda through Lambda Web Adapter, which is an AWS blog and
     open source pattern, not a managed service.

   It would keep server rendering, which buys little behind a sign-in wall. It would
   also keep a second place where requests are authenticated.

3. React Router in framework mode (server rendering). It carries the same trade-off as
   option 2 under a different framework.

## Decision

Adopt option 1.

- **Build and hosting.**
  - Vite builds static assets into an S3 bucket served by the same CloudFront
    distribution as the API
    ([ADR-0009](0009-aws-topology-environments-and-operations.md)).
  - The API is reached at the same origin under `/api/*`, so the session cookie set by
    the API's auth endpoints is sent without CORS and without third-party cookie rules
    ([ADR-0005](0005-identity-and-authorization.md)).
- **UI carried over as-is.**
  - The design tokens in `src/app/globals.css`, the three web fonts and the component
    recipes move to `apps/web`.
  - Components under `src/components/` are ported largely as they are. Most are already
    client components. The page wrappers that call `getServices()` are replaced by
    fetches through the generated TypeScript client.
- **Routing, data fetching and i18n.** These are chosen when the port starts. The
  candidates below are to be evaluated, and none is adopted yet:
  - Unverified candidate: TanStack Router for typed routes.
  - Unverified candidate: TanStack Query for fetching and caching.
  - Unverified candidate: next-intl's framework-agnostic core, to keep the ICU catalogs
    under `messages/` as they are.
  - Whatever is chosen must keep the `localizing-ui` invariants: typed message keys, and
    catalogs whose shape one catalog sets.
- **Locale.** The locale comes from the learner's profile (`/v1/me`), falling back to
  the browser's language before sign-in. URL locale prefixes and `src/proxy.ts` go away,
  together with the trap its matcher guards against.
- **Public pages later.** A public landing or marketing page is a separate static page,
  built later. It does not justify server rendering for the app itself.

## Consequences

### Positive

- The web client and the native apps consume the same contract. A feature that works on
  the web works through the same endpoints on iOS and Android.
- No web server exists to host, scale or keep on a supported runtime.
- The component code, which is most of the UI's substance, survives the move.

### Negative

- First paint waits for the bundle and one API round trip. Loading states that server
  rendering hid become visible. The existing skeleton
  (`src/components/home/home-skeleton.tsx`) becomes the normal path, not the exception.
- Rewriting the page wrappers, routing and i18n plumbing is real work, even though the
  components carry over.
- Skills written for Next.js have to be rewritten or retired as the port lands:
  `building-app-routes`, and parts of `localizing-ui` and `designing-ui`.

### Follow-ups

- Choose the router, the data-fetching layer and the i18n library in a spike. Record the
  choice as an amendment to this ADR.
- Carry the rendered component tests over to the new tree. Replace `pnpm test:smoke`
  (which serves a Next.js build) with a smoke test against the built SPA and the local
  API.

## Open questions

- Unverified: the candidate libraries above, and whether each works with React 19 and
  the toolchain versions this repository pins.
- Whether the SPA needs an offline mode of its own, or whether offline stays a
  native-app feature ([ADR-0007](0007-http-api-contract-and-offline-sync.md)).
- Where the public landing page lives: the same bucket or a separate site.

## Sources

- Amplify Hosting documents Next.js 12–15 SSR support, checked 2026-09-23:
  https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html
- Lambda Web Adapter pattern (AWS blog), checked 2026-09-23:
  https://aws.amazon.com/blogs/compute/using-response-streaming-with-aws-lambda-web-adapter-to-optimize-performance/

## Related

- [ADR-0001](0001-server-owned-logic-behind-one-api.md): every client is an API client
- [ADR-0005](0005-identity-and-authorization.md): the cookie session the SPA relies on
- [ADR-0007](0007-http-api-contract-and-offline-sync.md): the contract the SPA consumes
- [ADR-0009](0009-aws-topology-environments-and-operations.md): S3 and CloudFront
  hosting
- [References](../references.md)
