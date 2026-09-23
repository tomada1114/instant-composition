# ADR-0009: AWS topology, environments and operations

- Status: Accepted (2026-09-23): the topology, managing infrastructure as code, and the
  production level. Still Proposed, to be settled with the owner: separate `dev` and
  `prod` AWS accounts, and CDK as the infrastructure-as-code tool (see Open questions).
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

- AWS Organizations with separate `dev` and `prod` member accounts. People sign in
  through IAM Identity Center.
- The dev account also hosts the Cognito user pool that local development signs in
  against ([ADR-0005](0005-identity-and-authorization.md)).

**Infrastructure as code: AWS CDK in TypeScript, in `infra/`.**

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

**Deploys.**

- GitHub Actions assumes a deploy role through OIDC, so no long-lived AWS keys exist.
- `dev` deploys on merge. `prod` waits behind a manual approval.
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
  and the duration.
- Alarms cover the API's 5xx rate, Lambda errors and throttles, and DynamoDB throttles.
- One dashboard shows traffic, errors and latency. Tracing is a candidate, not a
  baseline.

**Email.** Sign-up and recovery email go through Amazon SES rather than Cognito's
built-in sender. Unverified: the exact limits of Cognito's built-in email, which is the
reason for this choice.

**Data protection.**

- DynamoDB point-in-time recovery and deletion protection are on in `prod`.
- Account deletion and data export are features, not scripts. They work per learner
  partition (ADR-0006).

### Fixed and baseline costs

Prices are as of 2026-09-23. A region appears only where the source states one.

| Component                     | Cost model                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| CloudFront flat-rate Free     | $0/month; 1M requests and 100 GB included; WAF, DDoS protection, bot management included |
| CloudFront flat-rate Pro      | $15/month; 10M requests included; no overage charges                                     |
| Cognito Lite / Essentials     | 10,000 MAU/month free; Essentials $0.015 per MAU beyond                                  |
| AWS Budgets                   | Free without actions; first two budgets with actions free, then $0.10/day each           |
| Parameter Store (standard)    | No additional charge                                                                     |
| Secrets Manager               | $0.40 per secret-month, $0.05 per 10,000 API calls                                       |
| API Gateway, Lambda, DynamoDB | Per request / duration / storage. Unverified: Tokyo unit prices                          |
| Avoided: NAT gateway          | Hourly + per GB (example: us-east-2 $0.045/hour, $0.045/GB)                              |
| Avoided: ALB                  | Hourly + LCU (example: us-east-1 $0.0225/hour, $0.008/LCU-hour)                          |
| Avoided: interface endpoints  | Per endpoint per AZ-hour (example: $0.01/AZ-hour) + $0.01/GB                             |

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
- Two accounts, Identity Center and an OIDC deploy role are more setup than a single
  account. This is accepted at the chosen production level.
- Lambda cold starts add latency to the first request after idle. It is measured, not
  assumed. The drill's timer runs on the client, so it is not affected.

### Follow-ups

- Bootstrap Organizations, the accounts, Identity Center and Budgets before any other
  stack.
- Write the `foundation` stack first. Local development needs its Cognito user pool
  before any production deploy.
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
- **Separate `dev` and `prod` accounts, or one account.** The owner is weighing whether
  a personal-scale service needs hard account isolation, and whether development may use
  production data and configuration. One account with a stack per stage is less setup
  and lets dev read real data; separate accounts bound the blast radius of an IAM
  mistake or a destructive deploy, keep learners' personal data out of development, and
  give each stage its own budget. The foundation stack, the Cognito user pool that local
  development signs in against, and the deploy workflow all depend on the answer, so it
  is settled before Phase 2 starts.
- **The infrastructure-as-code tool.** CDK in TypeScript is proposed because the rest of
  the server is TypeScript, the AWS tooling available to this project supports it, and
  AgentCore's own deploy path (`agentcore deploy`) uses it
  ([ADR-0012](0012-agents-and-agentcore.md)). The owner wants the tool that is easiest
  to operate with that tooling; confirm before the first stack is written.
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

## Related

- [ADR-0005](0005-identity-and-authorization.md): Cognito and the auth endpoints
- [ADR-0006](0006-persistence-on-dynamodb.md): the tables in `foundation`
- [ADR-0007](0007-http-api-contract-and-offline-sync.md): the contract behind `/api/*`
- [ADR-0008](0008-web-client-as-static-spa.md): the SPA served from S3
- [ADR-0010](0010-entitlements-and-billing.md): the per-learner cost guard
- [References](../references.md)
