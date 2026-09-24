---
name: designing-errors
description: >
  Covers the shape of an error type and the vocabulary of its `code` string in
  packages/*, apps/* and scripts/** — the HTTP error.code list in
  packages/contracts/src/errors.ts, the domain and application failure unions, and stage
  prefixes such as ERR_AGENTS_* reported on stderr. Use when adding or changing an Error
  subclass or a failure union, choosing or renaming an ERR_* code, deciding what an
  error may carry and what it must never carry (a credential, a prompt, a model's
  output), wiring an AbortSignal rejection reason, or writing the PR line that a changed
  code needs.
---

# Designing Errors

**Owns:** the shape of an error type and the vocabulary of `code` strings, in the
packages, the apps and `scripts/**`. **Does not own:** general type-system judgment
(`writing-typescript`); how an error is asserted in a test (`writing-tests`); how
`apps/api` turns a code into a response and a log line (`serving-the-api`); the full
stderr message shape for repository automation (`writing-repo-scripts` — the `ERR_`
prefix rule below is shared with it).

## The one rule that matters

**`code` is the contract; `message` is not.** A caller branches on `code` because it is
a stable string literal; `message` is prose for a human reading a log and may be
reworded at any time. Never write a test, a catch clause, or a script's own error
handling that matches on `message` text — match on `code`, or on the error's class via
`instanceof`.

## Shape of an error class

- Subclass `Error`, set `this.name` to the class name in the constructor, and declare
  `readonly code` as a **literal** type — never `string`. The literal is what lets a
  consumer narrow on `code` and get a typed error back.
- Two spellings, both correct, chosen by how many failures the class covers. One class
  over a closed vocabulary takes the code as a constructor parameter typed as the union;
  a class per failure declares `readonly code = "ERR_..." as const`. A class whose
  `code` widens to `string` gives a consumer nothing to switch on and is the shape to
  reject in review.
- Keep the underlying failure on `cause` rather than folding it into `message`, so a log
  can still show it without any caller having to know the failing library's error
  classes.

```ts
export class SchemaMismatchError extends Error {
  /** Literal, not `string`: this is what a caller narrows on. */
  readonly code = "ERR_SCHEMA_MISMATCH" as const;

  /** The path that failed — never the value that was at it. */
  readonly path: string;

  constructor(path: string, options?: ErrorOptions) {
    super(`The value at ${path} did not match the expected schema.`, options);
    this.name = "SchemaMismatchError";
    this.path = path;
  }
}
```

## What an error may never carry

An error travels further than the code that raised it: into a log, an aggregator, a
crash report, and — through a response body — back to whoever made the request. Decide
what it holds on that basis, not on what would be convenient to debug with.

- **Never a credential.** No API key, no `Authorization` header, no URL with a token in
  its query string, no environment value read through `apps/api/src/env.ts`.
- **Never request content.** The parsed request body and anything a third party sent
  back are data someone else supplied; a message that quotes them turns every log line
  into a copy of them. Name the shape instead — a field path, a length that was
  exceeded, an allowed set — not the content.
- A handler answers with the failure's `code`, an HTTP status and one fixed sentence,
  and sends **none** of a dependency's own error text, because that text can carry the
  request back to the caller. The dependency's error is on `cause`, which is for the
  server-side log and stops there.
- For an argument-validation error, the field that names what was rejected is the dotted
  path as written in the public signature (`options.maxLength`) — never an internal
  variable name, which can be renamed without that being a contract change.

## Aborts keep the caller's reason by identity

When a function reports an abort, the reason the caller passed must survive as the same
object, not as a fresh error carrying the same message — a caller that aborts with its
own instance compares `error.cause === myReason` to learn that _its_ cancellation is
what happened, and a copy breaks that.

- Return the reason itself when it already is an `Error`, and otherwise wrap it, keeping
  the raw value (a string, `undefined`, anything `abort()` may carry) on `cause`. Pin
  both halves in a test — identity for an `Error` reason, wrapping for a non-`Error`
  one.
- The mirror image, for a function that _raises_ the abort: pass the exact same error
  instance to `controller.abort(...)` and to the rejection, so a cooperating operation
  reading `signal.reason` sees the identical object the caller's `catch` receives.

## Choosing a `code` string

- `ERR_` prefix, `SCREAMING_SNAKE_CASE`, describing the failure rather than the function
  that raised it (`ERR_SCHEMA_MISMATCH`, not `ERR_PARSE_FAILED`).
- The codes a client sees are one list: `STATUS_BY_CODE` in
  `packages/contracts/src/errors.ts`. The failure unions below it — `PracticeError` in
  `packages/domain`, `ApplicationError` in `packages/application` — use those same
  strings rather than a prefix of their own, because a command's failure reaches the
  client unrenamed; `tests/contracts-schemas.test.ts` holds the application's codes
  inside the contract's. A failure no client ever sees — an app refusing to start —
  carries its app's prefix instead (`ERR_API_ENV_*`, `ERR_API_ROUTE_TABLE`), and the web
  client's own `ERR_NETWORK` stands for no readable answer at all.
- Each vocabulary lives in one file. Group its members in that file's TSDoc by what a
  caller can _do_ about each, which is the axis a vocabulary is built on, not which
  dependency produced it. Add a member there, once, rather than per implementation: a
  new member changes what every implementation promises.
- Under `scripts/**`, the code carries the stage prefix of the check that raised it
  (`ERR_AGENTS_*` in `scripts/sync-agents.mjs`, `ERR_LABELS_*` in
  `scripts/lib/labels-manifest.mjs`, `ERR_GIT_*`, `ERR_GH_*`), so the code alone —
  without opening the script — tells you which check to go read. Pick an existing stage
  prefix over inventing a new one when the failure belongs to a check that already has
  one.
- When a function can fail for several structurally different reasons, model them as a
  discriminated union keyed on `code` (or one class per reason) rather than one class
  with several optional fields — a consumer should be able to `switch` on `code` and get
  every field narrowed, not check which optional fields happen to be set.

## Changing a `code`

Nothing here is published, so this is not a semver decision. It is still a contract
change: AGENTS.md counts the `error.code` vocabulary of the HTTP surface among the
things a caller outside the process observes, so adding, renaming, or removing one
changes what a client's `switch` compiles against and what an operator's alerting
matches on.

- Say so in the PR body, in one line naming the old code, the new one, and what a client
  has to change. A code that changes silently is one nobody downstream finds out about
  until an alert stops firing.
- There is a compile-time backstop for one half of it: every table keyed by a code
  closes with `satisfies Record<TheErrorCode, …>` — `MESSAGE_BY_CODE` against
  `STATUS_BY_CODE`'s keys is the model — so a code added to or removed from the union
  fails `pnpm typecheck` until each table agrees. It cannot see a client's `switch`, and
  it cannot see a `scripts/**` code at all. A changed code also changes the contract's
  document: `pnpm contracts:openapi` rewrites `packages/contracts/openapi.json`, and
  `pnpm web:client` the web client's types generated from it. **BACKGROUND:**
  `building-web-screens`.
