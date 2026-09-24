# Roadmap

The phases that take the code at `d2a5cd9` to the target in [vision.md](vision.md).

The owner set the order:

1. Restructure locally.
2. Stand up a `dev` environment on AWS with real sign-in, and use the app there daily.
3. Build the planned features on `dev`: LLM feedback and its usage limits, vocabulary,
   more languages.
4. Add the production guards, then launch.
5. Native apps and agents come after the launch.

Production is expected one to two years out. It waits for the features because running a
second environment for years would double the operating work and the cost.

Two rules shape what lands where:

- Whatever is hard to add later (learner isolation, authentication, the data shape,
  infrastructure as code, fast deploys) is built early.
- Whatever can be added later waits for the production-guard phase
  ([ADR-0009](adr/0009-aws-topology-environments-and-operations.md) sorts each
  mechanism).

Phases 0 through 4 are ordered. The order of 5, 6, 8 and 9 is open and is decided as the
owner uses the app; 7 follows 6. Phases 10 through 13 are ordered.

Each phase lists its goal, scope, exit criteria, AWS footprint, and the ADRs it
realizes. An exit criterion is something that can be observed, not a task that was done.

## How the work is tracked

`steering-the-roadmap` decides what is worked on next and keeps this page and the
tracker in step.

- **One parent issue per phase.** Its title is "Phase N — …", and it holds the goal and
  the exit criteria. It carries `on hold` because it is a container, not a unit of work.
- **Sub-issues.** A phase's work items are sub-issues of its parent, ordered by
  `Depends on: #N` lines.
- **No dates.** There are no due dates and no schedule. Only the order is recorded.
- **Issues are cut when a phase comes within reach.** Phases 0 and 1, and the first step
  of Phase 2, have work items now. A later phase is split when it starts, against the
  code, skills and ADRs that exist by then.
- **Platform skills record only this project's decisions.** A phase that introduces a
  platform area (infrastructure code, logging, authentication, LLM calls) also adds or
  extends a project skill for it. That skill holds only what this project decided;
  general platform knowledge stays with official documentation and the vendors' own
  skills (`authoring-skills`).

## Phase 0 — Restructure the core (local, no AWS)

**Goal.** The application core exists in its target shape and is tested on its own. The
Next.js app under `src/` stays as it is until Phase 1 retires it.

**Scope.**

- Convert the repository into a pnpm workspace with `packages/`, while the existing
  Next.js app keeps building. `apps/` and `infra/` join it with their first package, in
  Phases 1 and 2.
- Build `packages/domain` from the rules in `src/core/`, with day arithmetic that takes
  the learner's time zone instead of reading the process's. The rules are copied, not
  moved: `src/core/` stays behind for the Next.js app and goes with it in Phase 1.
- Build `packages/application`:
  - commands and queries for the current features;
  - `RequestContext` and one `authorize` policy;
  - async ports bound to a LearnerId;
  - projections in place of full-log replays.
- An in-memory store adapter and the isolation contract suite: write as one learner,
  read through every method as another, get nothing.

The existing pages and handlers are not pointed at the application layer, and today's
SQLite store is not adapted to the new ports. The owner does not use the Next.js app
while the restructure is under way, so keeping it working on the new core would be work
Phase 1 throws away; it stays frozen instead, still building and passing its smoke test,
until the SPA and the API replace it.

**Exit.**

- Every current feature has a command or a query in `packages/application`, tested
  against the in-memory store.
- The isolation suite is green.
- No module under `packages/` other than `packages/domain` computes a practice day.

**Landed** at `48a9967` (#56, #57, #59, #60). How each exit was observed:

- Each method of `src/server/services`' `Services` has a command or a query in
  `packages/application`: `startRound`, `recordAnswers`, `finishRound`,
  `updateSettings`, `home`, `records`, `recap`, `settingsPage` (which also carries the
  taxonomy `topics()` served) and `history`. `tests/application-commands.test.ts`,
  `tests/application-projections.test.ts` and `tests/application-queries.test.ts` run
  them against the in-memory store.
- `tests/application-memory-store.test.ts` runs the isolation contract suite in
  `tests/learner-store-contract.ts`, and passes.
- `packages/application` reaches the practice day only through `todayOf`, which calls
  `packages/domain`'s `dayOf` with the learner's time zone and boundary hour.

**AWS.** None.

**Realizes.** [0002](adr/0002-architecture-style-and-repository-layout.md),
[0003](adr/0003-bounded-contexts-and-activity-integration.md) (boundaries),
[0005](adr/0005-identity-and-authorization.md) (context and policy, no Cognito yet),
[0006](adr/0006-persistence-on-dynamodb.md) (store shape).

## Phase 1 — Split the API from the web (local)

**Goal.** Every client goes through one versioned API; Next.js and `node:sqlite` are
gone.

**Scope.**

- `packages/contracts`: request and response schemas, with the OpenAPI 3.1 document
  generated from them and committed. It covers the endpoints the current commands and
  queries back; `/v1/me` arrives with learner registration in Phase 3, and
  `GET /v1/rounds/{roundId}` with the offline answer queue in Phase 5.
- `apps/api`: a Hono application serving the `/v1` paths under the `/api` root, so a
  client calls `/api/v1/...`
  ([ADR-0007](adr/0007-http-api-contract-and-offline-sync.md)), writing structured logs
  from its first handler.
- `packages/adapters`: the DynamoDB store, run against DynamoDB local's Docker image on
  a checkout and as a service container in CI, passing the same contract suite as the
  in-memory store, which moves there from `packages/application`.
- A catalog snapshot ready for language pairs:
  - items anchored on the target-language sentence, with per-L1 prompt and explanation
    and CEFR levels;
  - built from the existing Japanese-to-English content at build time.
- `apps/web`: a Vite + React SPA ported from `src/components/`, keeping Tailwind v4,
  shadcn/ui and the "instrument" design lock, and calling the API with TypeScript types
  generated from the OpenAPI document (the calls are hand-written; see ADR-0008's
  amendment).
- Retire Next.js and `node:sqlite`, and with them the rest of `src/`, whose rules Phase
  0 copied into the packages; rewrite AGENTS.md and the skills for the new layout.
- No import of the SQLite progress. The local records were test runs and the owner
  discards them; the cards under `content/` carry over unchanged.

**Exit.** The SPA talks to the local API, which talks to DynamoDB local; no Next.js
dependency remains; the OpenAPI document is generated, not hand-written.

**Landed** at `621f9bc` (#63, #67, #68, #72, #74, #76, #78, #81). How each exit was
observed:

- `tests/stack-smoke.test.ts` serves the `pnpm web:build` output and `apps/api` on
  DynamoDB local and asserts over HTTP, through the SPA's same-origin `/api` path; it
  passes in `pnpm check:source` with `pnpm db:up`, and in CI against the service
  container. `pnpm test:dynamodb` runs the store contract suite against DynamoDB local.
- No `package.json` in the workspace declares `next`, `next-intl` or any other Next.js
  package, `pnpm-lock.yaml` resolves none, and `src/` no longer exists.
- `packages/contracts/openapi.json` is built from the zod schemas
  ([ADR-0013](adr/0013-openapi-generated-from-zod-json-schema.md));
  `tests/contracts-openapi.test.ts` regenerates it and fails on any difference, and
  `tests/web-openapi-client.test.ts` does the same for the web client's types.

**AWS.** None; DynamoDB local only.

**Realizes.** [0001](adr/0001-server-owned-logic-behind-one-api.md),
[0004](adr/0004-multi-language-content-model.md) (schema),
[0006](adr/0006-persistence-on-dynamodb.md),
[0007](adr/0007-http-api-contract-and-offline-sync.md),
[0008](adr/0008-web-client-as-static-spa.md).

## Phase 2 — The AWS dev foundation

**Goal.** The `dev` account is secured, and its stateful stack deploys from CI.

**Scope.**

- Secure the current account before anything runs in it:
  - MFA on the root user, and no root access keys;
  - an IAM administrator with MFA;
  - `aws login` for short-lived CLI credentials;
  - Budgets alerts.

  The account stays standalone, because joining an organization forfeits its Free-plan
  credits.

- Upgrade the account to the Paid plan before the Free plan's six months end, or when a
  service `dev` needs is not on the Free plan. Upgrading keeps the credits; a Free-plan
  account that reaches the end of its plan closes.
  - Every service this phase uses is on the Free plan's service list
    ([references](references.md#operations-and-cost)), so the phase starts on the Free
    plan.
  - The phase stays on the Free plan as far as the work allows; nothing in it brings the
    upgrade forward.
  - The owner watches the plan's end date and the credit balance and upgrades when
    either comes near (#49); an agent does not track them.

- `infra/`: a CDK app with a stage setting. The `foundation` stack in `dev` holds:
  - the DynamoDB table, retained by CloudFormation on stack deletion or replacement,
    without point-in-time recovery or deletion protection until the Paid-plan upgrade
    ([ADR-0009](adr/0009-aws-topology-environments-and-operations.md));
  - the Cognito user pool, with self sign-up off.
- Deploy to `dev` on every merge to `main`, from GitHub Actions through OIDC. This is a
  gate change, so it goes through `changing-gates`.
- A project skill for how this repository writes, stages and deploys its infrastructure.

**Exit.**

- A merge to `main` updates the `dev` stack with no command run by hand.
- No long-lived AWS access key exists.
- A budget alert is configured.

**AWS.** IAM, Budgets, CloudFormation (the CDK bootstrap), DynamoDB, Cognito.

**Realizes.** [0009](adr/0009-aws-topology-environments-and-operations.md) (accounts,
stages, foundation stack, deploys).

## Phase 3 — Identity

**Goal.** Real sign-in, with learners isolated end to end.

**Scope.**

- Sign-in through the API:
  - web sessions through API-hosted auth endpoints that set HttpOnly cookies;
  - Bearer tokens for native clients;
  - both resolved by one authenticator.
- Learner registration on first sign-in: an internal LearnerId, time zone, L1 and UI
  locale, read and changed through `/v1/me`.
- The project's authentication conventions recorded next to `isolating-learner-data`.

**Exit.**

- Signing in against the `dev` user pool works from a local checkout.
- Two administrator-created learners cannot see each other's data through the API.
- Tests verify tokens without calling Cognito.

**AWS.** Cognito (`dev`).

**Realizes.** [0005](adr/0005-identity-and-authorization.md).

## Phase 4 — Daily use on dev

**Goal.** The owner uses the app every day, from a phone and a laptop, on `dev`.

**Scope.**

- The `app` stack in `dev`:
  - CloudFront on the flat-rate Free plan;
  - S3 for the SPA;
  - an API Gateway HTTP API;
  - the API on Lambda (`nodejs24.x`), with no VPC.
- The deploy-on-merge pipeline extended to the `app` stack.
- The observability baseline, sized to CloudWatch's free tier: alarms on API errors,
  Lambda errors and throttles, and DynamoDB throttles, plus one dashboard.
- Point-in-time recovery (7 days) and deletion protection turned on for the `dev` table,
  once the account is on the Paid plan
  ([ADR-0009](adr/0009-aws-topology-environments-and-operations.md)).

**Exit.**

- The `dev` URL serves the app over HTTPS, to the owner only.
- A merge reaches it with no manual step.
- An alarm fires on API errors.
- `aws dynamodb describe-continuous-backups` and `aws dynamodb describe-table` show
  point-in-time recovery and deletion protection on for the `dev` table.

**AWS.** CloudFront, S3, API Gateway, Lambda, CloudWatch.

**Realizes.** [0008](adr/0008-web-client-as-static-spa.md),
[0009](adr/0009-aws-topology-environments-and-operations.md).

## Phase 5 — Use and improve

**Goal.** Live with the product without language models, and settle the foundation.

**Scope.**

- Learner model v0: weaknesses by grammar item and topic.
  - They are derived by rules from the learning record and the cards' grammar tags.
  - They feed into deck composition.
- The offline answer-queue semantics in the API:
  - client-reported answer time, with server-side bounds;
  - late answers accepted into the round's day;
  - idempotent replay;
  - `GET /v1/rounds/{roundId}`, so a client resumes a round with the answers already
    recorded.
- Optionally, typed answers captured alongside self-grades.
  - They are the labels a grading evaluation will need later.
  - The current timer (6 to 20 seconds per card) is too short for typing, so this needs
    its own timing rule.

**Exit.** Weak points visibly change what a round deals; a batch of answers replayed
twice changes nothing the second time.

**AWS.** No new services.

**Realizes.** [0003](adr/0003-bounded-contexts-and-activity-integration.md)
(learner-model), [0007](adr/0007-http-api-contract-and-offline-sync.md) (offline).

## Phase 6 — LLM feedback

**Goal.** LLM feedback on typed answers, with quality and cost both measurable.

**Scope.**

- LLM grading of typed answers:
  - a task port and structured output;
  - per-call telemetry;
  - an SQS worker, with results keyed by answer id.
- The evaluation harness and its CI gate.
- A per-feature cost dashboard.
- The limit held on the provider side: a Budgets action that denies Bedrock
  ([ADR-0010](adr/0010-entitlements-and-billing.md), sequencing step 1).

**Exit.**

- A graded answer shows its cost, model and prompt version in the logs.
- A prompt change that lowers agreement with the gold set fails CI.
- The budget action is armed.

**AWS.** Bedrock, SQS, a Budgets action.

**Realizes.** [0011](adr/0011-llm-integration-and-evaluation.md),
[0010](adr/0010-entitlements-and-billing.md) (step 1).

## Phase 7 — Entitlements

**Goal.** Per-learner limits are enforced by the application long before anyone else can
sign up.

**Scope.**

- First, the owner's decision on AGENTS.md's "Rate limiting" amendment. Without it,
  ledger code does not merge.
- The ledger:
  - reserve and settle, keyed by the job key;
  - the wiring rule that a billed task needs a reservation.
- Stripe in its test mode. The allowance-or-credits policy may still be open.

**Exit.** A learner without balance cannot trigger a billed call; a replayed job and a
duplicate webhook each change the balance once.

**AWS.** No new services.

**Realizes.** [0010](adr/0010-entitlements-and-billing.md) (step 2).

## Phase 8 — Vocabulary activity

**Goal.** A second activity that shares the learner, the learning record and the
scheduler.

**Scope.**

- Rebuild vocabulary in the new layout.
- Unify scheduling on FSRS by replaying the composition log into FSRS state.
- Extract engagement (streaks, points, daily goal) so it counts both activities.

**Exit.**

- One daily goal counts composition and vocabulary.
- Both activities schedule with FSRS.
- A weak grammar point found in composition can influence vocabulary selection, and the
  other way round.

**Realizes.** [0003](adr/0003-bounded-contexts-and-activity-integration.md).

## Phase 9 — More languages

**Goal.** A second L1 for English — Chinese or Spanish, to be chosen — then other target
languages.

**Scope.**

- Per-L1 prompts and explanations for existing items.
- UI catalogs for the new locale.
- The LLM-only review gate for languages the owner cannot read, evaluated first against
  the human-reviewed Japanese-to-English set.

**Exit.** A new language pair is visible to learners only after its review gate passes.

**Realizes.** [0004](adr/0004-multi-language-content-model.md),
[0011](adr/0011-llm-integration-and-evaluation.md).

## Phase 10 — Production guards

**Goal.** Everything a public service needs that `dev` did not.

**Scope.**

- The accounts:
  - AWS Organizations, with a new management account;
  - the current account invited in as `dev`;
  - `prod` created;
  - IAM Identity Center in place of the IAM user.
- The `foundation` and `app` stacks deployed to `prod` with the prod stage.
- Deploys to `prod` behind a manual approval.
- SES for authentication email, and WAF rate-based rules.
- Account deletion and data export.
- The `prod` point-in-time recovery period.
- A privacy policy and terms of use.
- Live payments.

**Exit.**

- The `prod` stacks exist but are not yet open.
- A deploy to `prod` needs an approval and leaves an audit trail.
- A learner can delete their account and download their data.

**AWS.** Organizations, IAM Identity Center, SES, WAF rules; the stacks in `prod`.

**Realizes.** [0009](adr/0009-aws-topology-environments-and-operations.md),
[0010](adr/0010-entitlements-and-billing.md) (step 3).

## Phase 11 — Production launch

**Goal.** The same app, open to anyone.

**Scope.** Self sign-up switched on in `prod`, the terms and privacy policy published,
and the alarms watched through the first weeks.

**Exit.** The production URL accepts public sign-ups, and an alarm fires on API errors
and on budget thresholds.

**Realizes.** [0009](adr/0009-aws-topology-environments-and-operations.md).

## Phase 12 — Native apps

**Goal.** iOS and macOS in Swift, Android in Kotlin, on the same API.

**Scope.**

- Clients generated from the OpenAPI document.
- The offline answer queue on the device.
- In-app purchases feeding the same ledger.
- The API's deprecation policy in force, because an installed app cannot be forced to
  update at once.
- Whether an app downloads the whole catalog snapshot or only each day's rounds is
  decided here, weighing transfer cost against latency. Today's 1,020 cards compress to
  about 200 KB.

**Exit.** A native client completes a round offline and syncs it without duplicates; no
client needed a server change beyond the published contract.

**Realizes.** [0007](adr/0007-http-api-contract-and-offline-sync.md),
[0010](adr/0010-entitlements-and-billing.md).

## Phase 13 — Agents and the content pipeline

**Goal.** Agentic features where they earn their cost, and card generation moved off the
owner's machine.

**Scope.**

- AgentCore-based conversational features, if one is chosen, with tools that call the
  application's commands.
- Card generation on Step Functions and Bedrock batch inference, behind the LLM review
  gate.

**Realizes.** [0011](adr/0011-llm-integration-and-evaluation.md),
[0012](adr/0012-agents-and-agentcore.md).

## Deliberately later

- **Production before the features.** A second environment run for years doubles the
  operating work and the cost; `dev` is enough while the owner is the only user.
- **LLM features for anyone but the owner before the ledger.** A billed feature without
  a per-learner check is an open-ended bill. Until Phase 7 only the owner can sign in.
- **Native apps before the launch.** Store distribution needs the public backend, and
  the contract should absorb vocabulary and more languages before three client platforms
  depend on it. The owner may still point a test build at `dev`.
- **Voice answers.** Typed answers are cheaper to grade and to evaluate; speech can feed
  the same grader later through a transcription step.
- **Cognito threat protection.** It requires the Plus plan, which has no free tier; it
  is switched on when abuse is observed, not in anticipation.
- **Restore drills and SLOs.** Point-in-time recovery is on from the start; rehearsing a
  restore and committing to service levels are a step beyond "portfolio grade".
- **An analytics store.** Evaluation and cost questions are answered from logs and
  exports until one of them genuinely needs ad hoc queries over learner data.
