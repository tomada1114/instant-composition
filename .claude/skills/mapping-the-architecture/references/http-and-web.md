# HTTP and web

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
  again. The round version guards adoption and updates together; its bounded adoption
  projection supplies the adopted cards, and existing review logs remain unchanged.
  Retry answers retain separate ids and entries. The HTTP acknowledgement remains empty
  `204`, and reload/summary returns the adopted result. A finished round still rejects
  unrecorded ids.
- The queue sends at most 20 pending answers per call, so live and resent answers share
  the same batch; the web keeps unsent ones in the tab's `sessionStorage`. Only a
  contract status/code refusal drops an unsent answer: temporary and unknown responses
  stay pending. A `Retry-After` deadline is stored beside deferred answers, with old
  answer arrays still readable; no resend is made before it, and a failed attempt stops
  the drain. A finish also obeys that deadline and retains retry hints from its own
  response, and stops if any earlier batch was not acknowledged. A client `answeredAt`
  is clamped between the round's start and the server's time, a late answer counts for
  its round's day and never rewinds an item's schedule, and rounds never expire.

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
