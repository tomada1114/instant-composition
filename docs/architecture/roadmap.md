# Roadmap

The phases that take the code at `d2a5cd9` to the target in [vision.md](vision.md). The
order follows the owner's sequence: restructure and identity first, a public LLM-free
release next, then paid LLM features, more activities, more languages and native apps.
Phases 0 through 5 are ordered; the order of 6, 7 and 8 is open and will be decided when
Phase 5 ends.

GitHub issues are cut from Phase 0 and Phase 1 first. Later phases get issues when they
come within reach, so that an issue describes work that can start, not a wish.

Each phase lists its goal, scope, exit criteria, AWS footprint, and the ADRs it
realizes. An exit criterion is something that can be observed, not a task that was done.

## Phase 0 — Decide and restructure (local, no AWS)

**Goal.** The application core exists in its target shape, with the current app running
on top of it.

**Scope.**

- Accept or revise the Proposed ADRs. This tree is already registered as a documentation
  surface: `updating-docs` names it, `recording-architecture-decisions` owns it, and
  AGENTS.md's "Before changing the architecture" points agents at it.
- Convert the repository into a pnpm monorepo skeleton (`packages/`, `apps/`, `infra/`)
  while the existing Next.js app keeps building.
- Extract `packages/domain` from `src/core/`, with day arithmetic that takes the
  learner's time zone instead of reading the process's.
- Build `packages/application`: commands and queries for the current features,
  `RequestContext`, one `authorize` policy, and async ports bound to a LearnerId.
- An in-memory store adapter and the isolation contract suite: write as one learner,
  read through every method as another, get nothing.
- Point the existing pages and handlers at the application layer, so there is one path
  to the domain even before the API exists.

**Exit.** The current features run through the new application layer; the isolation
suite is green; no module outside `packages/domain` computes a practice day.

**AWS.** None.

**Realizes.** [0002](adr/0002-architecture-style-and-repository-layout.md),
[0003](adr/0003-bounded-contexts-and-activity-integration.md) (boundaries),
[0005](adr/0005-identity-and-authorization.md) (context and policy, no Cognito yet),
[0006](adr/0006-persistence-on-dynamodb.md) (store shape).

## Phase 1 — Split the API from the web (local)

**Goal.** Every client goes through one versioned API; Next.js and `node:sqlite` are
gone.

**Scope.**

- `apps/api`: a Hono application serving `/v1`, with the OpenAPI 3.1 document generated
  from `packages/contracts`.
- `apps/web`: a Vite + React SPA ported from `src/components/`, keeping Tailwind v4,
  shadcn/ui and the "instrument" design lock, calling the API through a generated
  TypeScript client.
- `packages/adapters`: the DynamoDB store, run locally against DynamoDB local, passing
  the same contract suite as the in-memory store.
- A catalog schema that is ready for language pairs — items anchored on the
  target-language sentence, per-L1 prompt and explanation, CEFR levels — carrying only
  the existing Japanese-to-English content, published as a build-time snapshot.
- Retire Next.js and `node:sqlite`; rewrite AGENTS.md and the skills for the new layout.
- Optionally, a one-off import of the owner's existing SQLite progress.

**Exit.** The SPA talks to the local API, which talks to DynamoDB local; no Next.js
dependency remains; the OpenAPI document is generated, not hand-written.

**AWS.** None; DynamoDB local only.

**Realizes.** [0001](adr/0001-server-owned-logic-behind-one-api.md),
[0004](adr/0004-multi-language-content-model.md) (schema),
[0006](adr/0006-persistence-on-dynamodb.md),
[0007](adr/0007-http-api-contract-and-offline-sync.md),
[0008](adr/0008-web-client-as-static-spa.md).

## Phase 2 — Identity (dev account)

**Goal.** Real sign-up and sign-in, with learners isolated end to end.

**Scope.**

- The account layout decided first (separate dev and prod accounts, or one account;
  [ADR-0009](adr/0009-aws-topology-environments-and-operations.md) open question). As
  proposed: AWS Organizations with separate dev and prod accounts, IAM Identity Center
  for human access, and AWS Budgets before any other resource.
- The CDK foundation stack in dev: the Cognito user pool and the DynamoDB table.
- Web sessions through API-hosted auth endpoints that set HttpOnly cookies; Bearer
  tokens for native clients; both resolved by one authenticator.
- Learner registration on first sign-in: an internal LearnerId, time zone, L1 and UI
  locale.

**Exit.** Signing up and signing in against the dev user pool works from a local
checkout; two learners cannot see each other's data through the API; tests verify tokens
without calling Cognito.

**AWS.** Organizations, IAM Identity Center, Budgets, Cognito, DynamoDB (dev).

**Realizes.** [0005](adr/0005-identity-and-authorization.md),
[0009](adr/0009-aws-topology-environments-and-operations.md) (accounts, foundation
stack).

## Phase 3 — Public launch, LLM-free (prod account)

**Goal.** The drill is live for anyone to sign up and use, at near-zero fixed cost.

**Scope.**

- The CDK app stack: CloudFront on a flat-rate plan with WAF, S3 for the SPA, API
  Gateway HTTP API, the API on Lambda (`nodejs24.x`), no VPC.
- Deployments from GitHub Actions through OIDC, with production behind a manual
  approval.
- Structured logs, alarms and a dashboard; SES for authentication email.
- Account deletion and data export.
- A privacy policy and terms of use; public self sign-up switched on.

**Exit.** The production URL serves the app; a deploy to prod needs an approval and
leaves an audit trail; a learner can delete their account and download their data; an
alarm fires on API errors and on budget thresholds.

**AWS.** CloudFront, WAF, S3, API Gateway, Lambda, CloudWatch, SES; the foundation stack
in prod.

**Realizes.** [0009](adr/0009-aws-topology-environments-and-operations.md).

## Phase 4 — Use and harden

**Goal.** Live with the product LLM-free and settle the foundation before paid features.

**Scope.**

- Learner model v0: weaknesses by grammar item and topic, derived by rules from the
  learning record and the cards' grammar tags, fed into deck composition.
- The offline answer-queue semantics in the API: client-reported answer time with
  server-side bounds, late answers accepted into the round's day, idempotent replay.
- Optionally, typed answers captured alongside self-grades. They are the labels a
  grading evaluation will need later; the current timer (6 to 20 seconds per card) is
  too short for typing, so this needs its own timing rule.

**Exit.** Weak points visibly change what a round deals; a batch of answers replayed
twice changes nothing the second time.

**AWS.** No new services.

**Realizes.** [0003](adr/0003-bounded-contexts-and-activity-integration.md)
(learner-model), [0007](adr/0007-http-api-contract-and-offline-sync.md) (offline).

## Phase 5 — Entitlements and LLM feedback

**Goal.** Paid LLM feedback on typed answers, with quality and cost both measurable.

**Scope.**

- The entitlement ledger, and the owner's decision between a monthly allowance and
  prepaid credits, with Stripe as the first payment source.
- LLM grading of typed answers: a task port, structured output, per-call telemetry, an
  SQS worker, and results keyed by answer id.
- The evaluation harness and its CI gate; a per-feature cost dashboard.

**Exit.** A graded answer shows its cost, model and prompt version in the logs; a prompt
change that lowers agreement with the gold set fails CI; a learner without allowance or
credit cannot trigger a billed call.

**AWS.** Bedrock, SQS; a Budgets action as the last-resort brake on Bedrock spend.

**Realizes.** [0010](adr/0010-entitlements-and-billing.md),
[0011](adr/0011-llm-integration-and-evaluation.md).

## Phase 6 — Vocabulary activity

**Goal.** A second activity that shares the learner, the learning record and the
scheduler.

**Scope.** Rebuild vocabulary in the new layout; unify scheduling on FSRS by replaying
the composition log into FSRS state; extract engagement (streaks, points, daily goal) so
it counts both activities.

**Exit.** One daily goal counts composition and vocabulary; both schedule with FSRS; a
weak grammar point found in composition can influence vocabulary selection and vice
versa.

**Realizes.** [0003](adr/0003-bounded-contexts-and-activity-integration.md).

## Phase 7 — More languages

**Goal.** A second L1 for English — Chinese or Spanish, to be chosen — then other target
languages.

**Scope.** Per-L1 prompts and explanations for existing items, UI catalogs for the new
locale, and the LLM-only review gate for languages the owner cannot read, evaluated
first against the human-reviewed Japanese-to-English set.

**Exit.** A new language pair is visible to learners only after its review gate passes.

**Realizes.** [0004](adr/0004-multi-language-content-model.md),
[0011](adr/0011-llm-integration-and-evaluation.md).

## Phase 8 — Native apps

**Goal.** iOS and macOS in Swift, Android in Kotlin, on the same API.

**Scope.** Clients generated from the OpenAPI document; the offline answer queue on
device; in-app purchases feeding the same ledger; the API's deprecation policy in force,
because an installed app cannot be forced to update at once.

**Exit.** A native client completes a round offline and syncs it without duplicates; no
client needed a server change beyond the published contract.

**Realizes.** [0007](adr/0007-http-api-contract-and-offline-sync.md),
[0010](adr/0010-entitlements-and-billing.md).

## Phase 9 — Agents and the content pipeline

**Goal.** Agentic features where they earn their cost, and card generation moved off the
owner's machine.

**Scope.** AgentCore-based conversational features if one is chosen, with tools that
call the application's commands; card generation on Step Functions and Bedrock batch
inference, behind the LLM review gate.

**Realizes.** [0011](adr/0011-llm-integration-and-evaluation.md),
[0012](adr/0012-agents-and-agentcore.md).

## Deliberately later

- **LLM features before Phase 5.** A public LLM feature without an entitlement check is
  an open-ended bill, and the owner wants the foundation settled on real use first.
- **Voice answers.** Typed answers are cheaper to grade and to evaluate; speech can feed
  the same grader later through a transcription step.
- **Cognito threat protection.** It requires the Plus plan, which has no free tier; it
  is switched on when abuse is observed, not in anticipation.
- **Restore drills and SLOs.** Point-in-time recovery is on from the start; rehearsing a
  restore and committing to service levels are a step beyond "portfolio grade".
- **Native apps before vocabulary.** The API contract should absorb a second activity
  before three client platforms depend on it.
- **An analytics store.** Evaluation and cost questions are answered from logs and
  exports until one of them genuinely needs ad hoc queries over learner data.
