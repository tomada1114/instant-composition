---
name: isolating-learner-data
description: >
  Covers keeping one learner's data away from other learners and from agents acting for
  them: authenticating once into a RequestContext and Actor, stores bound to a learner,
  authorize(actor, command), 404 for another learner's resource, Cognito JWT
  verification, the Origin check on the cookie path, and the cross-learner tests every
  store and endpoint needs. Use when adding or changing an endpoint, a store method or
  adapter, a query that filters by learner, session or token handling, a job or a
  language-model tool that touches learner data, or a data-isolation test.
---

# Isolating Learner Data

**Owns:** the rules that keep a learner's data reachable only by that learner, and by
actors working for them within a grant — how identity enters a request, how stores are
scoped, where authorization is decided, and the tests that prove it. **Does not own:**
error types and what they may carry (`designing-errors`); route and handler files
(`building-app-routes`); the shape of commands and ports (`designing-application-core`);
how a test case is written (`writing-tests`); secrets and `.env*` (AGENTS.md "Security
and human approval"). The decisions are ADR-0005, 0006 and 0012 under
`docs/architecture/adr/`.

AGENTS.md's "Security and human approval" carries the prohibition itself, because an
agent meets it while working on something else. This skill holds the reasoning and the
procedure.

## Why the rule is structural

Sign-up is self-service and the repository is public, so the first multi-learner release
turns every forgotten filter into a leak. Later, language-model tools act on a learner's
behalf, and a prompt injection controls their arguments. The design therefore makes the
wrong query impossible to write, instead of relying on each call site remembering a
filter.

## Identity enters once

- The edge authenticates once per request and produces a `RequestContext`: the actor,
  the learner (id and timezone), the time, a request id. Nothing below the edge
  re-derives identity from a header or a cookie.
- An actor is a **learner**; a **system** actor (a job, which carries the learner it
  works for from its own verified record); or an **agent** acting on behalf of a learner
  within named grants. A system or agent actor is never broader than the learner it
  serves.
- A native app sends `Authorization: Bearer` with an access token; the web client sends
  the session cookie set by the API's auth endpoints. One authenticator port accepts
  either and yields the same actor.
- Verify every Cognito access token against the user pool's JWKS with `aws-jwt-verify`,
  with `tokenUse: "access"` and the expected `clientId`. Never decode a token without
  verifying it: the AgentCore sample that reads claims unverified is safe only because
  Runtime verified the token first (ADR-0012), and is not a pattern to copy.
- `LearnerId` is internal. Map Cognito's `sub` to it at sign-in and use the LearnerId in
  keys, logs and URLs, so a new identity provider or a linked account never rewrites
  data.

## Stores are bound to a learner

- Application code receives a store already bound to the learner — `forLearner(id)` or
  its equivalent — whose methods take no learner id. The adapter writes the id into
  every key (the DynamoDB partition key) or filter, so a service cannot express "read
  another learner's rounds" at all.
- A learner id is never taken from a request body, a path or query parameter, or a
  language-model tool argument. A path id names a resource such as a round; the bound
  store resolves it inside the learner's own partition, so another learner's round is
  simply not found.
- Reading across learners is for a system actor with a named purpose — account deletion,
  data export, aggregate metrics — through a separate, explicitly named port, never
  through a flag on the learner-bound store.

## Authorization in one place

- `authorize(actor, command)` is the one decision on whether an actor may run a command.
  While every learner acts only on their own data it is nearly trivial; it exists so
  agent grants and system jobs are added to one table instead of scattered across
  handlers.
- Another learner's resource answers 404 with the same body a missing one gets, never
  403 — a 403 confirms the id exists.
- The cookie path checks `Origin` on every state-changing request and rejects a missing
  or foreign origin; a Bearer request carries no ambient credential and needs no such
  check.
- A tool offered to a language model or an agent declares no learner-id parameter. The
  learner comes from the verified session the runtime passes, and grants narrow which
  commands the agent may reach.

## Tests that prove it

- Every store adapter runs the shared isolation contract suite: write as learner A, call
  every read method bound to learner B, and expect nothing; write as B and expect A's
  data unchanged. Running the same suite against every adapter, the in-memory one
  included, is what keeps the fake honest.
- Every endpoint gets a cross-learner HTTP test: B's credential against A's resource id
  answers 404 and changes nothing.
- Tests never call Cognito. Sign tokens with a locally generated key and point the
  verifier at that key set, so the real verification path is what runs.
- A new store method or endpoint without its cross-learner case is unfinished, the same
  way an endpoint without a test is.

## What never leaves

- A response, a log line or an error carries no other learner's data and no credential —
  no token, no cookie, no `Authorization` header. Log the LearnerId and the command's
  name, never a request body or an email. **REQUIRED:** `designing-errors` for what an
  error may carry.
- Text a learner wrote, such as a typed answer, goes to a language model as delimited
  data, never as instructions. The grader has no tools, so a successful injection can
  only change its author's own grade (ADR-0011).
