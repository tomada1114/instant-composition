---
name: writing-infrastructure
description: >
  Covers this repository's own infrastructure decisions in infra/, the AWS CDK app: the
  stage setting and what differs between dev and prod, the foundation / app split and
  its Parameter Store hand-off, the Retain policies, the app stack's CloudFront, HTTP
  API, Lambda bundle, hosted web app client, Custom::WebClientSecret and alarms, the
  GitHub OIDC deploy role, how a stack change is tested and deployed, and which AWS
  resources need the owner's OK. Use when changing anything under infra/, running pnpm
  cdk, editing .github/workflows/deploy-dev.yml, or when a Deploy dev run fails.
---

# Writing Infrastructure

**Owns:** the decisions this repository has made about its AWS infrastructure and how
`infra/` expresses them. **Does not own:** general CDK and CloudFormation knowledge (the
vendor's `aws-cdk` skill and AWS documentation); why the topology is what it is
(**BACKGROUND:** `mapping-the-architecture`); the code the API function runs and the
names it reads (`serving-the-api`); how the client secret is read and a learner signed
in (`authenticating-learners`); workflow lint rules (**REQUIRED:** `changing-gates` for
any edit to `deploy-dev.yml`).

## One app, two stages

`infra/` is the workspace package `@instant-composition/infra`: one CDK app that builds
either stage from its `stage` context value, `-c stage=dev` or `-c stage=prod`. A
missing or unknown stage throws `UnknownStageError` (`ERR_INFRA_UNKNOWN_STAGE`) before
any template is written. `prod` is "the same thing, deployed with the prod stage", never
a second design.

- A stage setting lives next to the construct it changes, as a `Record<Stage, …>` —
  `TABLE_PROTECTED` in `infra/src/foundation-stack.ts` is the pattern. A new stage
  difference is an architecture change: update `mapping-the-architecture` in the same
  pull request.
- What differs today: the learner table's point-in-time recovery and deletion protection
  (on in `prod`, off in `dev` by the owner's choice), the user pool's self sign-up
  (`SELF_SIGN_UP`: off in `dev`, where only an administrator creates users), the local
  web app client and its sign-in domain (`WEB_CLIENT`: `dev` only, with `127.0.0.1:5173`
  redirects; `prod` gets one once it has a URL), and the `deploy-access`, `edge` and
  `app` stacks, which only `dev` builds (`buildApp` in `infra/src/app.ts`): `prod` is
  not hosted until the production-guard phase, so it builds `foundation` alone.
- Every stage deploys to `ap-northeast-1` (`REGION`), except `edge`, which holds what
  CloudFront can take from us-east-1 alone (`EDGE_REGION`). No stack reads
  `process.env`: `infra/tsconfig.json` loads no Node types, so a setting that is not in
  the CDK context fails to compile.
- A stack's construct id is the same in every stage (`foundation`, `deploy-access`,
  `edge`, `app`), so a CLI command names it the same way. Its CloudFormation name
  carries the stage: `instant-composition-<stage>-<id>`.
- The CDK CLI's usage telemetry is off for this app: `infra/cdk.json`'s `context` sets
  `"cli-telemetry": false`, so neither a local `pnpm cdk` run nor `Deploy dev` reports
  it. `pnpm cdk cli-telemetry --status` from `infra/` confirms it.
- The other context keys: `repository-root`, which `infra/cdk.json` sets to `..` for a
  CLI run in `infra/` and without which a stage that builds `app` throws
  `MissingRepositoryRootError` (`ERR_INFRA_REPOSITORY_ROOT`), since the function is
  bundled from the checkout; and `web-dist` and `alarm-email`, which only a deploy
  passes ("Deploying").

## The stacks

- **`foundation`** holds what keeps state and rarely changes: the learner table and the
  Cognito user pool. Each resource that holds state has `RemovalPolicy.RETAIN`, which
  sets `DeletionPolicy` and `UpdateReplacePolicy` to `Retain` in every stage, `dev`
  included, because the owner's own learning history lives there. The user pool also has
  deletion protection in every stage: a new pool issues new `sub`s, which strands every
  learner's data. Its sign-in settings (email as the username, case-insensitive) cannot
  change without replacing it. In `dev` the pool also has the local checkout's
  confidential web app client (`webClientOptions`: code grant, `openid`, refresh-token
  rotation, an empty `ExplicitAuthFlows` so `ALLOW_REFRESH_TOKEN_AUTH` stays off), a
  prefix domain for managed login whose prefix carries the stack id's first group so it
  is unique in the region, and the client's Cognito-provided managed login style,
  without which managed login shows no page. Keep a logical id stable once deployed,
  because a changed id replaces the resource. Let CloudFormation name the resources, so
  that a replacement never collides with a name in use.
- **The hand-off.** `foundation` publishes its identifiers as free standard-tier
  `String` parameters under `/instant-composition/<stage>/foundation/`
  (`FOUNDATION_PARAMETERS` in `infra/src/foundation-parameters.ts` names them), and
  `app` resolves them by name at deploy time. Never an export: an imported export locks
  the exporting value. Parameter Store is regional, so `edge`'s web ACL ARN is the one
  value `app` reads with `Fn::GetStackOutput`, naming us-east-1 and `edge`'s `WebAclArn`
  output. `tests/infra-app-stack.test.ts` fails on an export and on any other
  `Fn::GetStackOutput`. CDK's own cross-stack references are never used: the tests
  synthesize without `cdk.json`'s context, so they would build a different template than
  a deploy. The stack outputs (`LearnerTableName`, `UserPoolId`, `WebClientId`,
  `SignInDomainUrl`; `app`'s `WebUrl`, `SpaBucketName`, `DistributionId`) carry no
  `exportName` and are for people and a local run, which reads them with
  `aws cloudformation describe-stacks`. No client secret is ever an output.
- **`app`** (`dev` only) holds what is rebuilt often: the distribution, the SPA bucket,
  the HTTP API, the API function, the hosted web app client and its secret, the alarms,
  and the Bedrock budget with its action (`infra/src/bedrock-budget.ts`). It depends on
  `foundation` for deploy order alone, never the reverse. The hosted client lives here,
  not in `foundation`, because its redirect URLs are the distribution's, and
  `foundation` must never depend on `app` (owner, 2026-09-28). Read
  [references/app-stack.md](references/app-stack.md) before changing any construct in
  it: each holds a decision a plausible edit would undo.
- **`edge`** (`dev` only, us-east-1) holds the `CLOUDFRONT`-scope WAF web ACL that the
  distribution's flat-rate plan requires and no other Region can hold. It allows every
  request and has no rule, since `dev` needs none; a rule counts against the Free plan's
  five, and a rule group of our own blocks the plan. `app` depends on it for deploy
  order alone. us-east-1 has its own CDK bootstrap, run once by hand from `infra/`
  (`pnpm cdk bootstrap aws://<account-id>/us-east-1`); a stack in a new Region needs the
  same before its first deploy.
- **`deploy-access`** (`dev` only) holds the GitHub OIDC identity provider and the
  deploy role. The owner deployed it once by hand, with
  `pnpm cdk deploy -c stage=dev deploy-access`, because the workflow needs the role
  before it can deploy anything. A change to it is deployed by hand again, and the PR
  says so.

## The deploy role's scope

- **Trust:** only this repository's `main` branch. The `StringEquals` condition checks
  `aud = sts.amazonaws.com` and `sub` = `DEPLOY_SUBJECT`. That subject uses GitHub's
  **immutable** format,
  `repo:tomada1114@<owner-id>/instant-composition@<repo-id>:ref:refs/heads/main`,
  because the repository has `use_immutable_subject` on
  (`gh api repos/tomada1114/instant-composition/actions/oidc/customization/sub`). A
  name-based subject never matches (#116). Never add a `StringLike` or a wildcard
  subject.
- **Permission:** only `sts:AssumeRole` on this account's `cdk-*` bootstrap roles, which
  carry the deploy permissions themselves. The owner chose this scope over administrator
  access. A new resource type needs no change to the role, and neither does a new
  Region: a bootstrap role's name carries its Region, so `cdk-*` matches every one.
- The role's ARN reaches the workflow as the repository **variable**
  `AWS_DEPLOY_ROLE_ARN`, never as a secret and never in the tree. No long-lived AWS
  access key exists anywhere, for a person or for CI.
- `prod` has no deploy role yet. Its deploy waits behind a manual approval, which a
  trust keyed on `refs/heads/main` cannot express, so that trust is designed in the
  production-guard phase.

## Testing a stack change

- `pnpm cdk synth -c stage=<stage>` needs no AWS credentials. The
  `tests/infra-*.test.ts` suites synthesize every stage in `pnpm check:quick`. Assert
  the properties that matter on the template with `aws-cdk-lib/assertions`: keys,
  billing, the Retain policies, per-stage protection, trust conditions and the exact
  permission. Assert them for every stage the setting differs in. Snapshot tests are not
  used here.
- The suites synthesize with asset bundling off (`infraContext` in
  `tests/infra-context.ts`), so they run neither esbuild nor the catalog build.
  `tests/infra-api-bundle.test.ts` is the one suite that bundles the function as a
  deploy does and starts the bundle. `tests/infra-web-client-secret.test.ts` runs the
  secret writer's inline Python, so the infra suites need `python3` on the `PATH`.
- `tests/infra-app-stack.test.ts` lists every resource type `app` may hold. A new type
  fails it until the list changes, which is the moment to check it against "What needs
  the owner's OK".
- A new `aws-cdk-lib/<module>` import is a boundary edit. `infra/` imports
  `aws-cdk-lib`, `constructs` and the subpaths its row lists, each by its exact
  specifier, and nothing of the application. Add the subpath to both
  `eslint.config.mjs`'s `INFRA_NPM_EDGES` and `tests/boundaries.test.ts`'s row.

## Deploying

- `.github/workflows/deploy-dev.yml` runs on every push to `main`, with no approval
  step. It runs `pnpm web:build`, assumes the deploy role, and deploys `foundation`,
  then `edge`, then `app`, each with `--exclusively` so no command drags in another.
  Deploys queue in merge order and are never cancelled. `deploy-access` is never
  deployed from CI. Deploying another stack from CI is a change to those commands, made
  per `changing-gates`.
- The web build reaches the SPA bucket through the `app` stack, never through `aws s3`:
  `-c web-dist=<apps/web/dist>` adds two `BucketDeployment`s (`spa-deployment.ts`), run
  by the bootstrap roles, so the deploy role keeps its one permission. Fingerprinted
  `assets/*` are cached for a year and never pruned; everything else is `no-cache`,
  pruned, and its upload invalidates `/*`. Without `web-dist` nothing is uploaded, so
  synthesis, the tests and a hand deploy of `foundation` need no build, and a hand
  deploy of `app` without it removes the uploads but keeps the files.
- `-c alarm-email=<address>` comes from the repository **secret** `ALARM_EMAIL`, a
  secret so the address stays masked in the run's log. A deploy without it removes the
  alarm topic's subscription; the workflow still deploys and posts a warning.
- After a merge that changes a stack, confirm the `Deploy dev` run succeeded and read
  the live resource back (`aws dynamodb describe-table`, `aws iam get-role`, …) against
  what the tests assert. A green synth proves nothing about the account. For `app`, the
  `WebUrl` output is the check: `/` and a client route answer `200` with the SPA, and
  `/api/v1/home` without a session answers `401` `ERR_UNAUTHENTICATED` through
  CloudFront.
- Agents use `dev` credentials only (`aws login`, short-lived). When the session has
  expired, ask the owner to sign in again rather than working around it. Nothing an
  agent runs touches `prod`.

## What needs the owner's OK

A resource an issue already plans is created in `dev` without asking. A resource with a
fixed monthly cost of about $10 or more needs the owner's OK before the change that adds
it: an RDS instance, a NAT gateway, a load balancer, an interface endpoint, or anything
billed by the hour whether used or not. Check the price and write it in the PR. `prod`,
the account's plan, Organizations and IAM access keys stay the owner's. AGENTS.md's
"Security and human approval" holds that rule; this is where it bites.
