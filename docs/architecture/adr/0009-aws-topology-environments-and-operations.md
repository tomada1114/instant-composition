# ADR-0009: AWS topology, environments and operations

- Status: Accepted (2026-09-23), including the account layout, its timing, and CDK
- Date: 2026-09-23
- Deciders: the owner

## Context

The application runs today as a local `next start` process with progress in a SQLite
file. It is moving to AWS as a public service with self sign-up
([ADR-0005](0005-identity-and-authorization.md)), progress in DynamoDB
([ADR-0006](0006-persistence-on-dynamodb.md)), one HTTP API
([ADR-0007](0007-http-api-contract-and-offline-sync.md)) and a static web client
([ADR-0008](0008-web-client-as-static-spa.md)). Native apps and LLM features come later.

The owner set the production level to "portfolio grade":

- In scope:
  - separate AWS accounts per environment
  - infrastructure as code with deploys from CI
  - monitoring and alerts
  - DynamoDB point-in-time recovery
  - account deletion and data export
- Out of scope for now:
  - Cognito Plus threat protection, until abuse is observed
  - restore drills
  - service-level objectives

Fixed costs up to tens of thousands of JPY per year are acceptable. Components billed by
the hour whether used or not still need a reason to exist.

The owner also set the timing. Until the planned features exist (LLM feedback,
vocabulary, more languages), the owner is the only user, on a `dev` environment.
Production comes one to two years out, after a phase that adds the production guards
([roadmap](../roadmap.md)). What is hard to add later is built early; what can be added
later waits for that phase. The owner's AWS account is new and on the Free plan, and
anything that would end its credits early is deferred.

Keeping the credits is not the same as staying on the Free plan. A Free plan ends after
six months or when its credits run out, and an account that has not upgraded to the Paid
plan by then closes; upgrading keeps the remaining credits (checked 2026-09-23). The
owner accepts charges in `dev` of up to about $30 a month, so the account upgrades
whenever a service needs it, and before the six months end at the latest. Only what
forfeits the credits outright — creating or joining an organization — is deferred.

## Decision drivers

- Run cost should scale with use, with few components billed by the hour.
- The public contract must not carry infrastructure requirements (ADR-0007).
- Resources that hold state are separated from those that are rebuilt often. The
  stateful ones are protected from accidental replacement.
- Configuration is read at startup, not baked into a build. Secrets enter the process in
  one place (the rule today's `src/server/env.ts:110-133` encodes).
- Throughput limits sit at the edge, as AGENTS.md's "Rate limiting" section requires.

## Considered options

- **Front door and API**
  1. **CloudFront (flat-rate plan) → S3 for the SPA, and `/api/*` → API Gateway HTTP API
     → Lambda running the Hono app.**
  2. CloudFront → Lambda Function URL protected by origin access control (OAC). This is
     rejected because, with OAC, a `POST` or `PUT` to a Function URL requires the client
     to send the SHA-256 of the body in `x-amz-content-sha256`. Every Swift, Kotlin and
     web client would carry that infrastructure detail in the public contract.
  3. CloudFront → Function URL with authentication `NONE`, where CloudFront adds a
     secret origin header and the app rejects requests without it. This is cheaper than
     API Gateway and keeps the contract clean. The cost is a shared secret to rotate and
     no managed throttling behind CloudFront. It is kept as the fallback if API
     Gateway's per-request cost matters.
- **Rejected hosting**
  - Amplify Hosting: SSR support documented for Next.js 12–15 only. It is moot after
    ADR-0008.
  - App Runner: in maintenance from 2026-04-30 and not available to new customers.
  - ECS Fargate behind an ALB: the ALB bills per hour, and the tasks run continuously.

## Decision

Adopt option 1, in `ap-northeast-1`.

```text
learner ──► CloudFront (flat-rate plan: WAF, DDoS protection, bot management)
              ├─ /*      ──► S3 (SPA assets)
              └─ /api/*  ──► API Gateway HTTP API ──► Lambda nodejs24.x (Hono, `handle()`)
                                                        ├─► DynamoDB
                                                        ├─► Cognito (token verification keys)
                                                        └─► later: SQS → worker Lambda, Bedrock
```

**Network.**

- Nothing runs in a VPC, so there is no NAT gateway and no interface endpoint billed per
  hour.
- Lambda reaches DynamoDB, Cognito and, later, SQS and Bedrock through their public
  endpoints, authorized by IAM.

**Edge.**

- A CloudFront flat-rate plan, starting on Free and moving to Pro when traffic warrants.
- WAF rules, including throughput limits, live on the distribution, as AGENTS.md
  requires.
- Unverified: which rules, including rate-based rules, each plan tier allows.

**Accounts.**

- The target is AWS Organizations with three accounts:
  - a management account that holds only billing, IAM Identity Center and Budgets;
  - a `dev` member;
  - a `prod` member.

  No workload runs in the management account, because service control policies do not
  apply to it.

- Until the production-guard phase, the owner's existing standalone account **is the
  `dev` account**. Creating or joining an organization ends a Free-plan account's
  credits at once and moves it to the paid plan, so the organization waits. The account
  still upgrades to the Paid plan on its own before the Free plan ends (see Context),
  which keeps the credits.
- When the organization is created:
  - a new account becomes the management account;
  - the current account is invited in as `dev`, so dev's resources stay where they are;
  - `prod` is created inside the organization.
- Human access:
  - Until the organization exists, a person signs in to dev as an IAM user with MFA and
    gets short-lived CLI credentials through `aws login` (AWS CLI 2.32.0 or later). IAM
    Identity Center replaces that user once the organization exists.
  - The root user has MFA and no access keys.
  - No long-lived access key is issued to a person or an agent.
- Coding agents (Claude Code with the AWS MCP server) work with `dev` credentials only.
  Nothing reaches `prod` except the deploy workflow, behind its manual approval.
- Development never reads `prod`.
  - When the owner wants their own history in `dev`, it arrives through the learner data
    export, limited to their own partition.
  - The owner's `dev` data is not migrated to `prod`.
  - The reviewed cards need no migration: every deploy carries the same catalog snapshot
    ([ADR-0004](0004-multi-language-content-model.md)).
- The dev account also hosts the Cognito user pool that local development signs in
  against ([ADR-0005](0005-identity-and-authorization.md)).

**Infrastructure as code: AWS CDK in TypeScript, in `infra/`.**

- The server is TypeScript, so the infrastructure code can share its types and gates.
- The AWS tooling this project works with ships a dedicated CDK skill.
- AgentCore's deploy path (`agentcore deploy`) runs on CDK
  ([ADR-0012](0012-agents-and-agentcore.md)).
- Terraform has no such skill here and would need its own state store.
- SAM leaves CloudFront, WAF, Cognito and the stack split to raw CloudFormation.
- AWS Blocks (infrastructure from code) would put `@aws-blocks` imports into the
  application and replace the OpenAPI contract with typed imports, against
  [ADR-0002](0002-architecture-style-and-repository-layout.md) and
  [ADR-0007](0007-http-api-contract-and-offline-sync.md).

```text
foundation  stateful, rarely changed, retained on delete:
            Cognito user pool, DynamoDB tables (PITR, deletion protection), S3 buckets
app         rebuilt often: API Gateway, Lambda, CloudFront distribution, SPA asset bucket;
            later SQS and the worker Lambda
agents      later, only if ADR-0012's conditions are met
```

The `app` stack depends on `foundation`, and never the reverse. It reads foundation's
identifiers from SSM Parameter Store by name, not through CloudFormation exports, so
either stack can be updated on its own. Once another stack imports an exported value,
CloudFormation refuses to modify that value or delete the exporting stack (checked
2026-09-23) — the coupling the parameter-name approach avoids. CloudFormation's newer
`Fn::GetStackOutput` creates a weak reference without an export and is an alternative to
evaluate when the CDK app is written.

**Stages.** One CDK app builds either stage from the same code. `prod` is then "the same
thing, deployed with the prod stage", not a second design. The stage decides only these
settings:

| Setting                                           | `dev`                                                                 | `prod`                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| DynamoDB retain on delete and on replacement      | On — the owner's own learning history accumulates here for years      | On                                                              |
| DynamoDB deletion protection                      | On once the account is on the Paid plan (below)                       | On                                                              |
| DynamoDB point-in-time recovery                   | On once the account is on the Paid plan, with a 7-day recovery period | On; the period is set in the production-guard phase (1–35 days) |
| Cognito self sign-up                              | Off: only an administrator creates users (`AllowAdminCreateUserOnly`) | On                                                              |
| CloudFront flat-rate plan                         | Free                                                                  | Free, then Pro when traffic warrants                            |
| WAF rate-based rules, SES for authentication mail | None; Cognito's own sender is enough for admin-created users          | Yes                                                             |
| Deploy                                            | On every merge to `main`                                              | Behind a manual approval                                        |

The `dev` account stays on the Free plan as far as the work allows. Its service list
does not say whether point-in-time recovery and deletion protection may be enabled
([references](../references.md#operations-and-cost), checked 2026-09-24), and nothing
reads or writes the table before Phase 4. So the `dev` table is created without either,
and both are turned on as soon as the account is on the Paid plan, as a Phase 4 work
item. Until then a bad write cannot be undone and the table can be deleted directly; the
CloudFormation `Retain` deletion and update-replace policies, which need no plan
feature, keep it through any change made to the stack.

Point-in-time recovery is priced by table size whatever the recovery period, so the
7-day period in `dev` is a preference, not a saving. In `prod` the period also bounds
how long a deleted learner's data stays restorable, which the privacy policy has to
state.

**Deploys.**

- GitHub Actions assumes a deploy role through OIDC, so no long-lived AWS keys exist.
- `dev` deploys on every merge from the moment the first stack exists, because the owner
  wants the fast loop from the start. `prod` waits behind a manual approval.
- Adding the workflow is a gate change. It goes through the `changing-gates` skill and
  the owner's approval, and is never added as a side effect of another change.

**Configuration and secrets.**

- Each deployable has one config module, the successor to `src/server/env.ts`. It
  validates the environment once at startup.
- Secrets (the web app client's secret, and later the payment provider's keys) are read
  at startup through the AWS Parameters and Secrets Lambda extension. Its cache holds
  values for at most 300 seconds.
- Parameter Store `SecureString` is the default store. Secrets Manager is used where
  rotation is needed.

**Cost guard.**

- AWS Budgets is set up on the first day, before any other resource.
- When LLM features arrive, a budget action that attaches a deny policy for Bedrock
  becomes the account-level kill switch. The per-learner guard is the entitlements
  ledger ([ADR-0010](0010-entitlements-and-billing.md)).

**Observability baseline.**

- Structured JSON logs carry `requestId`, the command or query name, the outcome code
  and the duration. They are a code convention from the first handler on, not a
  monitoring feature.
- Alarms cover the API's 5xx rate, Lambda errors and throttles, and DynamoDB throttles.
- One dashboard shows traffic, errors and latency. Tracing is a candidate, not a
  baseline.
- The alarms and the dashboard exist from the first hosted `dev` deploy. They are sized
  to fit CloudWatch's free tier, so they cost nothing there. The logs themselves are
  billed by volume beyond that tier.

**Email.** In `prod`, sign-up and recovery email go through Amazon SES rather than
Cognito's built-in sender. Unverified: the exact limits of Cognito's built-in email,
which is the reason for this choice. `dev` creates its users by hand and keeps the
built-in sender.

**Data protection.**

- DynamoDB point-in-time recovery and deletion protection are on in both stages, in
  `dev` from the Paid-plan upgrade (see Stages).
- Account deletion and data export are features, not scripts. They work per learner
  partition (ADR-0006) and ship in the production-guard phase.

### Fixed and baseline costs

Prices are as of 2026-09-23. A region appears only where the source states one.

| Component                      | Cost model                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| CloudFront flat-rate Free      | $0/month; 1M requests and 100 GB included; WAF, DDoS protection, bot management included |
| CloudFront flat-rate Pro       | $15/month; 10M requests included; no overage charges                                     |
| Cognito Lite / Essentials      | 10,000 MAU/month free; Essentials $0.015 per MAU beyond                                  |
| Organizations, Identity Center | No additional charge; the free tier is shared once across an organization                |
| CloudWatch free tier           | 10 alarm metrics, 3 dashboards, 5 GB of log data per month                               |
| AWS Budgets                    | Free without actions; first two budgets with actions free, then $0.10/day each           |
| Parameter Store (standard)     | No additional charge                                                                     |
| Secrets Manager                | $0.40 per secret-month, $0.05 per 10,000 API calls                                       |
| API Gateway, Lambda, DynamoDB  | Per request / duration / storage. Unverified: Tokyo unit prices                          |
| Avoided: NAT gateway           | Hourly + per GB (example: us-east-2 $0.045/hour, $0.045/GB)                              |
| Avoided: ALB                   | Hourly + LCU (example: us-east-1 $0.0225/hour, $0.008/LCU-hour)                          |
| Avoided: interface endpoints   | Per endpoint per AZ-hour (example: $0.01/AZ-hour) + $0.01/GB                             |

## Consequences

### Positive

- The fixed monthly cost is near zero on the Free plan and $15 on Pro. Everything else
  scales with use.
- Clients see one origin and a plain HTTPS contract. No AWS signing requirement leaks
  into it.
- Stateful resources survive a broken `app` deploy. Separate accounts keep dev
  experiments away from learners' data.

### Negative

- API Gateway adds a per-request charge that option 3 would avoid.
- Three accounts, Identity Center and an OIDC deploy role are more setup than a single
  account. This is accepted at the chosen production level, and all of it except the
  deploy role waits for the production-guard phase.
- Until then, the only boundary between `dev` and everything else is the one account.
  That is acceptable while `dev` holds no one's data but the owner's.
- Lambda cold starts add latency to the first request after idle. It is measured, not
  assumed. The drill's timer runs on the client, so it is not affected.

### Follow-ups

- Before the first stack, secure the current account:
  - MFA on the root user, and no root access keys;
  - an IAM administrator with MFA and `aws login`;
  - Budgets alerts.

  Organizations, Identity Center and `prod` come in the production-guard phase.

- Upgrade the account to the Paid plan before the Free plan's six months end, or earlier
  when a service `dev` needs is not on the Free plan. Leaving it on the Free plan past
  that point closes the account.
- Write the `foundation` stack first. Local development needs its Cognito user pool
  before anything is hosted.
- Measure the Tokyo unit prices in the Pricing Calculator. Replace every Unverified row
  above.

## Open questions

- Unverified: Tokyo unit prices for API Gateway HTTP API, Lambda, DynamoDB on-demand and
  PITR, NAT, ALB and interface endpoints.
- Unverified: the WAF rule set and rate-based rules available on each CloudFront
  flat-rate tier.
- Unverified: Cognito's built-in email limits.
- Whether option 3 (Function URL plus an origin secret) is worth its rotation burden
  once real traffic prices API Gateway.
- Unverified: whether a Free-plan account can use every service `dev` needs (Cognito, a
  CloudFront flat-rate plan, API Gateway, Lambda, DynamoDB). Check when the first stack
  is written.
- The `prod` point-in-time recovery period, weighed against how long a deleted learner's
  data may stay restorable.
- Whether `/api/*` or a separate API hostname is better for native apps. A separate
  hostname decouples app releases from the web distribution but reintroduces CORS for
  the SPA.

## Sources

- CloudFront OAC for Lambda Function URLs (`x-amz-content-sha256` on POST/PUT), checked
  2026-09-23:
  https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html
- CloudFront flat-rate plans, checked 2026-09-23:
  https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html,
  https://aws.amazon.com/blogs/networking-and-content-delivery/amazon-cloudfront-flat-rate-pricing-plans-new-features-and-expanded-capabilities/,
  https://docs.aws.amazon.com/waf/latest/developerguide/cloudfront-features.html
- API Gateway HTTP API JWT authorizer, checked 2026-09-23:
  https://docs.aws.amazon.com/apigatewayv2/latest/api-reference/apis-apiid-authorizers.html
- Amplify Hosting SSR support, checked 2026-09-23:
  https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html
- App Runner availability change, checked 2026-09-23:
  https://aws.amazon.com/about-aws/whats-new/2026/03/aws-service-availability/
- Lambda Node.js runtimes, checked 2026-09-23:
  https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html
- Pricing pages, checked 2026-09-23: https://aws.amazon.com/vpc/pricing/,
  https://aws.amazon.com/elasticloadbalancing/pricing/,
  https://aws.amazon.com/privatelink/pricing/,
  https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/,
  https://aws.amazon.com/secrets-manager/pricing/,
  https://aws.amazon.com/systems-manager/pricing/,
  https://aws.amazon.com/cognito/pricing/
- Parameters and Secrets Lambda extension, checked 2026-09-23:
  https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html
- Cross-stack exports cannot change while imported; `Fn::GetStackOutput`, checked
  2026-09-23:
  https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/full.md
- Free-plan credits end when an account creates or joins an organization, checked
  2026-09-23: https://aws.amazon.com/free/free-tier-faqs/ and
  https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html
- A Free plan ends after six months or when its credits run out; the account then closes
  unless upgraded, and upgrading keeps the remaining credits, checked 2026-09-23:
  https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html
- One free tier per organization, and no fee for consolidated billing, checked
  2026-09-23:
  https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/useconsolidatedbilling-effective.html
  and
  https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/consolidated-billing.html
- Separate production from development accounts; no workloads in the management account,
  checked 2026-09-23:
  https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices.html,
  https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices_mgmt-acct.html
  and
  https://docs.aws.amazon.com/wellarchitected/2025-02-25/framework/sec_securely_operate_multi_accounts.html
- IAM Identity Center at no additional charge, checked 2026-09-23:
  https://aws.amazon.com/iam/identity-center/faqs/
- `aws login` short-term credentials, checked 2026-09-23:
  https://docs.aws.amazon.com/signin/latest/userguide/command-line-sign-in.html
- `aws login` needs `signin:AuthorizeOAuth2Access` and `signin:CreateOAuth2Token`, which
  the `SignInLocalDevelopmentAccess` managed policy grants, checked 2026-09-23:
  https://docs.aws.amazon.com/signin/latest/userguide/security-iam-awsmanpol.html
- Point-in-time recovery periods of 1–35 days, priced by table size, checked 2026-09-23:
  https://aws.amazon.com/blogs/database/announcing-configurable-point-in-time-recovery-periods-for-amazon-dynamodb/
- Cognito `AllowAdminCreateUserOnly`, checked 2026-09-23:
  https://docs.aws.amazon.com/sdk-for-kotlin/api/latest/cognitoidentityprovider/aws.sdk.kotlin.services.cognitoidentityprovider.model/-admin-create-user-config-type/allow-admin-create-user-only.html
- CloudWatch free tier, checked 2026-09-23: https://aws.amazon.com/cloudwatch/pricing/

## Related

- [ADR-0005](0005-identity-and-authorization.md): Cognito and the auth endpoints
- [ADR-0006](0006-persistence-on-dynamodb.md): the tables in `foundation`
- [ADR-0007](0007-http-api-contract-and-offline-sync.md): the contract behind `/api/*`
- [ADR-0008](0008-web-client-as-static-spa.md): the SPA served from S3
- [ADR-0010](0010-entitlements-and-billing.md): the per-learner cost guard
- [References](../references.md)
