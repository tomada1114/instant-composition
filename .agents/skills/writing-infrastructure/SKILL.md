---
name: writing-infrastructure
description: >
  Covers this repository's own infrastructure decisions in infra/, the AWS CDK app: the
  stage setting and what differs between dev and prod, the foundation / app stack split,
  the Retain policies on stateful resources, the GitHub OIDC deploy role and its scope,
  how a stack change is tested and deployed, and which new AWS resources need the
  owner's OK first. Use when adding or changing a stack, construct or stage setting
  under infra/, running pnpm cdk synth or deploy, editing
  .github/workflows/deploy-dev.yml, or when a Deploy dev run fails.
---

# Writing Infrastructure

**Owns:** the decisions this repository has made about its AWS infrastructure and how
`infra/` expresses them. **Does not own:** general CDK and CloudFormation knowledge (the
vendor's `aws-cdk` skill and AWS documentation); why the topology is what it is
(ADR-0009, **BACKGROUND:** `recording-architecture-decisions`); workflow lint rules
(**REQUIRED:** `changing-gates` for any edit to `deploy-dev.yml`).

## One app, two stages

`infra/` is the workspace package `@instant-composition/infra`: one CDK app that builds
either stage from its `stage` context value, `-c stage=dev` or `-c stage=prod`. A
missing or unknown stage throws `UnknownStageError` (`ERR_INFRA_UNKNOWN_STAGE`) before
any template is written. `prod` is "the same thing, deployed with the prod stage", never
a second design.

- A stage setting lives next to the construct it changes, as a `Record<Stage, …>` —
  `TABLE_PROTECTED` in `infra/src/foundation-stack.ts` is the pattern. A new stage
  difference must come from ADR-0009's Stages table; one that is not there owes the ADR
  an amendment first.
- What differs today: the learner table's point-in-time recovery and deletion protection
  (on in `prod`, off in `dev` until the Paid plan, #101), and the `deploy-access` stack,
  which only `dev` builds.
- Every stage deploys to `ap-northeast-1` (`REGION`). No stack reads `process.env`:
  `infra/tsconfig.json` loads no Node types, so a setting that is not in the CDK context
  fails to compile.
- A stack's construct id is the same in every stage (`foundation`, `deploy-access`), so
  a CLI command names it the same way. Its CloudFormation name carries the stage:
  `instant-composition-<stage>-<id>`.
- The CDK CLI's usage telemetry is off for this app: `infra/cdk.json`'s `context` sets
  `"cli-telemetry": false`, so neither a local `pnpm cdk` run nor `Deploy dev` reports
  it. `pnpm cdk cli-telemetry --status` from `infra/` confirms it.

## The stacks

- **`foundation`** holds what keeps state and rarely changes: the learner table now, and
  the Cognito user pool in Phase 3. Each resource that holds state has
  `RemovalPolicy.RETAIN`, which sets `DeletionPolicy` and `UpdateReplacePolicy` to
  `Retain` in every stage, `dev` included, because the owner's own learning history
  lives there. Keep a logical id stable once deployed, because a changed id replaces the
  resource. Let CloudFormation name the resources, so that a replacement never collides
  with a name in use.
- **`app`**, when it comes, holds what is rebuilt often: API Gateway, Lambda,
  CloudFront. It depends on `foundation`, never the reverse. It reads foundation's
  identifiers by name, never through a CloudFormation export, because an imported export
  locks the exporting value (ADR-0009). That is why `LearnerTableName` is a stack output
  with no `exportName`.
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
  access. A new resource type needs no change to the role.
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
- A new `aws-cdk-lib/<module>` import is a boundary edit. `infra/` imports
  `aws-cdk-lib`, `constructs` and the subpaths its row lists, each by its exact
  specifier, and nothing of the application. Add the subpath to both
  `eslint.config.mjs`'s `INFRA_NPM_EDGES` and `tests/boundaries.test.ts`'s row.

## Deploying

- `.github/workflows/deploy-dev.yml` runs on every push to `main`. It assumes the deploy
  role and runs `pnpm cdk deploy -c stage=dev foundation --require-approval never`, with
  no approval step. Deploys queue in merge order and are never cancelled. It deploys
  `foundation` only. Deploying a new stack from CI is a change to that command, made per
  `changing-gates`.
- After a merge that changes a stack, confirm the `Deploy dev` run succeeded and read
  the live resource back (`aws dynamodb describe-table`, `aws iam get-role`, …) against
  what the tests assert. A green synth proves nothing about the account.
- Agents use `dev` credentials only (`aws login`, short-lived). When the session has
  expired, ask the owner to sign in again rather than working around it. Nothing an
  agent runs touches `prod`.

## What needs the owner's OK

A resource an ADR or an issue already plans is created in `dev` without asking. A
resource with a fixed monthly cost of about $10 or more needs the owner's OK before the
change that adds it: an RDS instance, a NAT gateway, a load balancer, an interface
endpoint, or anything billed by the hour whether used or not. Check the price and write
it in the PR. `prod`, the account's plan, Organizations and IAM access keys stay the
owner's. AGENTS.md's "Security and human approval" holds that rule; this is where it
bites.
