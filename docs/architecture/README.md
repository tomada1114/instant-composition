# Architecture

This tree records where this application is going and why: the product vision, an honest
assessment of the code as it stands, the decisions that shape the rewrite, and the order
in which they land. It is written for anyone reviewing the design — including the owner
six months from now — and assumes no context beyond the repository.

Last reviewed 2026-09-23 against commit `d2a5cd9`.

## Reading order

1. [vision.md](vision.md) — what the product becomes, the principles every decision is
   checked against, and what is deliberately out of scope.
2. [current-state.md](current-state.md) — what the code at `d2a5cd9` already gets right,
   what blocks the target, and how the starting hypotheses were judged.
3. The ADRs below, in number order; each one stands alone but links to the ones it
   depends on.
4. [roadmap.md](roadmap.md) — the phases that realize the ADRs, with exit criteria.
5. [references.md](references.md) — the external sources behind every factual claim,
   with the date each was checked.

## Status legend

| Status     | Meaning                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Proposed   | A recommendation with its reasoning, not yet confirmed by the owner. Work may start on it only as an experiment. |
| Accepted   | Confirmed by the owner. Work builds on it.                                                                       |
| Superseded | Replaced by a later ADR, which it names. Kept for the reasoning, never edited into agreement.                    |

An ADR moves from Proposed to Accepted when the owner confirms it; the change is a
one-line edit to its status with the date. When the owner changes an Accepted decision,
the ADR is rewritten in place to state the current decision, with the reason, and its
status gains an "amended" date; the roadmap and the issues change with it. A new ADR
supersedes an old one only when the decision is replaced whole, and the old one gains a
"Superseded by" line. Several ADRs are partly Accepted — the owner confirmed the
direction while a detail below it is still a recommendation — and say which part is
which.

## Decisions

| ADR                                                           | Decision                                                                                                                                   | Status                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [0001](adr/0001-server-owned-logic-behind-one-api.md)         | All domain logic lives on the server behind one versioned HTTP API; the web SPA and the native apps are clients of it.                     | Accepted                                                           |
| [0002](adr/0002-architecture-style-and-repository-layout.md)  | Adopt the dependency rule, ports only at real seams, lightweight commands and projections; restructure into a pnpm monorepo.               | Accepted                                                           |
| [0003](adr/0003-bounded-contexts-and-activity-integration.md) | Cut context boundaries now; rebuild vocabulary later as a second activity sharing identity, the learning record and, eventually, FSRS.     | Accepted (boundaries now, vocabulary later); context list Proposed |
| [0004](adr/0004-multi-language-content-model.md)              | Anchor items on the target-language sentence with per-L1 prompts and explanations; CEFR as the canonical level scale.                      | Accepted                                                           |
| [0005](adr/0005-identity-and-authorization.md)                | Cognito for authentication; an internal LearnerId; learner-bound stores plus one `authorize` policy, proven by isolation tests.            | Accepted                                                           |
| [0006](adr/0006-persistence-on-dynamodb.md)                   | DynamoDB with one partition per learner; async, learner-bound stores that commit per command, with projections instead of full-log replay. | Accepted                                                           |
| [0007](adr/0007-http-api-contract-and-offline-sync.md)        | REST with OpenAPI 3.1 generated from zod, served by Hono; `/v1` path versioning; answers queued offline and replayed idempotently.         | Accepted; OpenAPI generation superseded by 0013                    |
| [0008](adr/0008-web-client-as-static-spa.md)                  | Replace Next.js with a Vite + React SPA on S3 and CloudFront, keeping the design lock and components.                                      | Accepted; port libraries amended                                   |
| [0009](adr/0009-aws-topology-environments-and-operations.md)  | CloudFront → API Gateway HTTP API → Lambda, no VPC; infrastructure as code; "portfolio grade" operations.                                  | Accepted                                                           |
| [0010](adr/0010-entitlements-and-billing.md)                  | A provider-agnostic usage ledger with reserve and settle, so the allowance-versus-credits choice can wait.                                 | Proposed                                                           |
| [0011](adr/0011-llm-integration-and-evaluation.md)            | Task-level LLM ports over one Bedrock client, structured output, per-call telemetry, and an evaluation harness that gates CI.              | Proposed                                                           |
| [0012](adr/0012-agents-and-agentcore.md)                      | Use AgentCore only for genuinely agentic features; the learner model stays in our own store.                                               | Proposed                                                           |
| [0013](adr/0013-openapi-generated-from-zod-json-schema.md)    | The OpenAPI 3.1 document is assembled in `packages/contracts` from zod's own `z.toJSONSchema()`, with no generator package.                | Accepted                                                           |
