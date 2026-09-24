---
name: building-web-screens
description: >
  Covers apps/web, the Vite + React SPA: adding or changing a screen or route in the
  TanStack Router tree in apps/web/src/router.tsx, reading the API through queries.ts
  and endpoints.ts over the client generated into apps/web/src/openapi/, pnpm web:client
  after a contract change, the /api proxy, pnpm dev and pnpm web, what
  apps/web/src/index.ts exports, and tests/web-harness.tsx. Use when a web screen,
  route, link, query or API call is added or changed, a screen shows ERR_NETWORK
  locally, or only pnpm test:smoke can see a change.
---

# Building Web Screens

**Owns:** how a screen enters `apps/web` — the route, the page that reads its data, the
screen it renders, the calls to the API, the local run, and what each check can see.
**Does not own:** the look of a screen and its components (`designing-ui`); the strings
it renders (`localizing-ui`); the HTTP contract and the API behind the proxy
(`serving-the-api`, and `packages/contracts` under ADR-0007 and ADR-0013); how a test
case is written (`writing-tests`) and which project it joins (`placing-tests`);
TypeScript idiom (`writing-typescript`).

ADR-0008 is why the client is a static SPA that reaches the API over HTTP; read it
before proposing server rendering, a second data layer or a route generator.

## A screen is a route, a page and a screen

Each area has its own directory under `apps/web/src/` (`home/`, `drill/`, `records/`,
`settings/`, `summary/`), and a screen is three pieces there:

- **The route**, in `apps/web/src/router.tsx`. The tree is written as code —
  `createRoute` with `getParentRoute`, a `path` and a `component`, then added to
  `rootRoute.addChildren` — and nothing generates it at build time. A search param is
  read through `validateSearch` returning a total value, so a missing or unknown one
  still yields a screen (`/drill`'s `kind` is the model).
- **The page** (`<Area>Page` in `<area>-page.tsx`) — the route's component. It reads its
  data, shows the loading and failed states (`PageLoading` and `PageLoadFailed` in
  `apps/web/src/lib/page-shell.tsx`), redirects with `Navigate`, and hands a finished
  view to the screen. Branching on what the API answered belongs here.
- **The screen** (`<Area>Screen`) — renders the view it is handed, and nothing it
  renders reads the network on its own. A save made from the screen goes through a hook
  beside it (`use-settings.ts`) that calls `endpoints.ts`.

Links and navigation are TanStack Router's `Link`, `Navigate` and `useNavigate`. The
router registers its tree through `declare module "@tanstack/react-router"`, so a path
the tree does not hold, or a `/drill` without its `kind`, fails `pnpm typecheck`. A path
carries no locale (**BACKGROUND:** `localizing-ui`). A path no route matches renders the
root route's `NotFound`; the host answers every path with the same `index.html`, and the
router decides.

## Reading and writing the API

`apps/web` imports no workspace package. Enforced by: `eslint.config.mjs`'s
`APP_WORKSPACE_EDGES` row for `web`, and `tests/boundaries.test.ts`. The contract
reaches it as types generated from `packages/contracts/openapi.json` into
`apps/web/src/openapi/` — types only, no generated fetch client.

- **One call per operation**, in `apps/web/src/lib/endpoints.ts`. Each checks what it
  sends against the operation's generated `<Operation>Data` with `satisfies` and reads
  the answer as its `<Operation>Responses`, so the path template, the body and the
  answer are the contract's rather than strings written here. A call returns a `Result`
  whose error is the envelope's `error.code`, or `ERR_NETWORK` when no readable answer
  came back; it never throws.
- **One query per read**, in `apps/web/src/lib/queries.ts`, as a `queryOptions` over
  that call. `valueOf` turns a failed `Result` into an `ApiRequestError` for the query
  cache, and `errorCodeOf` gets the code back out. The cache retries nothing and
  refetches nothing on focus (`createQueryClient`); a page that must not act on a cached
  view reads with `refetchOnMount: "always"` and waits for `isFetchedAfterMount`, as
  `HomePage` does.
- **A write** calls its function in `endpoints.ts` directly from the hook or the drill
  code that owns it; nothing here uses a mutation cache. A write the learner must not
  lose (an answer) goes through the drill's answer queue, which retries only what
  `recordAnswers` reports as `failed`.

**After a contract change**, regenerate both documents, in order, and commit what they
write: `pnpm contracts:openapi` rewrites `packages/contracts/openapi.json`, then
`pnpm web:client` rewrites `apps/web/src/openapi/`. `tests/contracts-openapi.test.ts`
and `tests/web-openapi-client.test.ts` fail until both are current, and fail a hand edit
of either too. A new operation then needs its call in `endpoints.ts`; a renamed field is
a type error at every place that read it.

## The surface tests import

`apps/web/src/index.ts` is the web client's surface: tests import it as
`@instant-composition/web`, and `main.tsx`, the browser entry, is not part of it. A
module a test drives directly is exported there by name. No default export anywhere
under `apps/web/src/` (`public-api/explicit-surface`); `apps/web/vite.config.ts` sits
outside that rule because Vite reads its default export.

A new npm import from `apps/web/src/` also needs its entry in `APP_NPM_EDGES`, by exact
specifier. **REQUIRED:** `managing-dependencies` before adding the package itself.

## Running it

```sh
pnpm dev    # DynamoDB local, the catalog snapshot if missing, the API and Vite, until Ctrl-C
pnpm db:down  # stop DynamoDB local afterwards; `pnpm dev` leaves it and its tables running
```

`pnpm dev` serves the client on `http://127.0.0.1:5173` and proxies `/api` to the API on
`API_PORT` (8787 unless the shell sets it), so the client calls its own origin exactly
as it will behind CloudFront. `pnpm web` runs the Vite dev server alone: without
`pnpm api` beside it every read fails and the screens show their failed state.
`pnpm web:build` writes the static bundle to `apps/web/dist/`.

The client reads no environment variable of its own: `vite.config.ts` loads no `.env`
file (`envDir: false`) and reads only the shell's `API_PORT`, for the proxy. Vite would
inline any `VITE_`-prefixed name into the bundle at build time — that is publication,
not configuration, and it is frozen into every deploy that shipped it. None exists; the
first one is a decision to state in the PR, and never a credential.

## What each check sees

- `pnpm exec vitest run tests/web-<screen>.test.tsx` renders the whole `App` at a path
  under jsdom through `tests/web-harness.tsx`: `renderApp(path)` mounts it, `fakeApi`
  stands in for `fetch` and records every call, `fakeTimers` and `settle` move the
  clocks. That covers the route, the page's branches, the screen and the calls it makes.
  A new screen gets its suite here, answering its reads with fixture views.
- `pnpm typecheck` sees the route tree, the catalog keys and the generated types.
- `pnpm web:build` sees that the bundle builds.
- Only `pnpm test:smoke`, after `pnpm web:build` and `pnpm db:up`, sees the seams: that
  the built document is served for every path, that it links a stylesheet Tailwind
  actually generated, and that `/api` reaches a real API over DynamoDB local. A green
  `pnpm check:quick` says nothing about any of those.
- Nothing runs a browser. Fonts loading, layout, motion and focus are seen by opening
  the screen under `pnpm dev`, which is still the only check that a screen looks right.
