# References

The external sources behind the architecture documents in this directory. Each entry
names the page, links to it, and states what the documents rely on it for. Prices and
availability change, so every figure is dated. A fact the research could not confirm is
listed under [Unverified](#unverified) instead of being stated as fact.

## Amazon Cognito and identity

- [Feature plans](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html)
  — covers the three plans (Lite, Essentials, Plus), that Essentials is the default for
  new pools, and that the plan can be switched per user pool at any time. Checked
  2026-09-23.
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/) — covers:
  - 10,000 MAU per month free on Lite and Essentials, and no free tier on Plus
  - Essentials $0.015 and Plus $0.020 per MAU (region not stated)
  - identity pools free of charge

  Checked 2026-09-23.

- [CreateUserPoolClient request](https://docs.aws.amazon.com/sdk-for-ruby/v3/api/Aws/CognitoIdentityProvider/Types/CreateUserPoolClientRequest.html)
  — callback URLs must be HTTPS, except `http://localhost`, `http://127.0.0.1` and
  `http://[::1]`, on any port. Checked 2026-09-23.
- [PKCE in the authorization code grant](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html)
  — authorization code with PKCE is supported; the only method is S256. Checked
  2026-09-23.
- [OAuth 2.0 grants in Amazon Cognito](https://aws.amazon.com/blogs/security/how-to-use-oauth-2-0-in-amazon-cognito-learn-about-the-different-oauth-2-0-grants/)
  — background on which grant fits which client. Checked 2026-09-23.
- [App clients](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html)
  — covers:
  - Confidential "traditional web application" clients get a secret.
  - Access tokens carry scopes and are meant for API authorization.
  - ID tokens carry user attributes.

  Checked 2026-09-23.

- [User pool security best practices](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-security-best-practices.html)
  — use a client secret only where the server alone can hold it, and store it in a
  secret store. Checked 2026-09-23.
- [Verifying a JSON Web Token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
  — `aws-jwt-verify`'s `CognitoJwtVerifier` with `tokenUse` and a required `clientId`
  (audience) check. Checked 2026-09-23.
- [Pre token generation trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html)
  — customizing access tokens needs event version V2_0 or later, which requires
  Essentials or Plus. Checked 2026-09-23.
- [Refresh tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)
  and
  [the rotation announcement](https://aws.amazon.com/about-aws/whats-new/2025/04/amazon-cognito-refresh-token-rotation/)
  — covers:
  - Refresh token rotation exists, with a grace period of up to 60 seconds.
  - Rotation needs `GetTokensFromRefreshToken` and is incompatible with
    `REFRESH_TOKEN_AUTH`.

  Checked 2026-09-23.

- [Threat protection](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-settings-threat-protection.html)
  and
  [Plus plan features](https://docs.aws.amazon.com/cognito/latest/developerguide/feature-plans-features-plus.html)
  — threat protection and adaptive authentication require the Plus plan. Checked
  2026-09-23.
- [Securing Cognito with AWS WAF](https://aws.amazon.com/blogs/security/how-to-monitor-optimize-and-secure-amazon-cognito-machine-to-machine-authorization/)
  — a WAF web ACL, including Bot Control, can be associated with a user pool. Checked
  2026-09-23.
- [Integrating user pools with identity pools](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-integrating-user-pools-with-identity-pools.html)
  — identity pools exchange tokens for temporary AWS credentials, which is only needed
  when a client calls AWS directly. Checked 2026-09-23.
- [Cognito roles and policies](https://aws.amazon.com/blogs/mobile/understanding-amazon-cognito-authentication-part-3-roles-and-policies/)
  and
  [DynamoDB fine-grained access conditions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html)
  — `dynamodb:LeadingKeys` with `${cognito-identity.amazonaws.com:sub}`. That value is
  the identity pool's identity id, not the user pool `sub`. Checked 2026-09-23.
- [Lambda testing guide](https://docs.aws.amazon.com/lambda/latest/dg/testing-guide.html)
  — the emulator AWS documentation points to (LocalStack) is maintained by a third
  party; no official Cognito emulator was found. Checked 2026-09-23.
- [HTTP API authorizers](https://docs.aws.amazon.com/apigatewayv2/latest/api-reference/apis-apiid-authorizers.html)
  and
  [Cognito as an HTTP API authorizer](https://repost.aws/knowledge-center/api-gateway-cognito-user-pool-authorizer)
  — HTTP APIs have a JWT authorizer configured with a Cognito issuer and audiences.
  Checked 2026-09-23.
- [Amplify HttpOnly cookies for server-rendered Next.js](https://aws.amazon.com/about-aws/whats-new/2025/03/aws-amplify-httponly-cookies-server-rendered-next-js-applications/)
  — Amplify's Next.js adapter supports HttpOnly cookies with Cognito managed login.
  Background only. Checked 2026-09-23.

## Hosting, network and edge

- [Amplify Hosting SSR support](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html),
  [SSR supported features](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-supported-features.html)
  and
  [Next.js version migration](https://docs.aws.amazon.com/amplify/latest/userguide/update-app-nextjs-version.html)
  — covers:
  - Next.js 12–15 are documented; features such as streaming and edge middleware are not
    supported.
  - Node 20, 22 and 24 runtimes are supported.

  Checked 2026-09-23.

- [Lambda Web Adapter with response streaming](https://aws.amazon.com/blogs/compute/using-response-streaming-with-aws-lambda-web-adapter-to-optimize-performance/)
  — runs an unmodified HTTP server on Lambda. It is an AWS blog and open source pattern,
  not a managed service. Checked 2026-09-23.
- [AWS service availability changes (March 2026)](https://aws.amazon.com/about-aws/whats-new/2026/03/aws-service-availability/)
  — App Runner enters maintenance from 2026-04-30 and is closed to new customers.
  Checked 2026-09-23.
- [Lambda Node.js runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)
  and
  [Node.js 24 on Lambda](https://aws.amazon.com/blogs/compute/node-js-24-runtime-now-available-in-aws-lambda/)
  — covers:
  - `nodejs24.x` is available, deprecation 2028-04-30.
  - `nodejs26.x` also exists.
  - Callback-style handlers are unsupported on Node 24.

  Checked 2026-09-23.

- [Restricting a Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
  and
  [OAC for Lambda function URLs](https://aws.amazon.com/blogs/networking-and-content-delivery/secure-your-lambda-function-urls-using-amazon-cloudfront-origin-access-control/)
  — with OAC, `POST` and `PUT` require the client to send the body's SHA-256 in
  `x-amz-content-sha256`. Checked 2026-09-23.
- [CloudFront flat-rate pricing plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html),
  [the launch post](https://aws.amazon.com/blogs/networking-and-content-delivery/introducing-flat-rate-pricing-plans-with-no-overages/)
  and
  [the update post](https://aws.amazon.com/blogs/networking-and-content-delivery/amazon-cloudfront-flat-rate-pricing-plans-new-features-and-expanded-capabilities/)
  — covers:
  - Tiers:
    - Free: $0/month, 1M requests, 100 GB.
    - Pro: $15/month, 10M requests.
    - Business: $200/month.
    - Premium: $1,000/month.
  - Each plan includes WAF, DDoS protection, bot management and Route 53 DNS.
  - There are no overage charges, and blocked requests do not count against the
    allowance.

  Checked 2026-09-23.

- [AWS WAF with CloudFront](https://docs.aws.amazon.com/waf/latest/developerguide/cloudfront-features.html)
  — a web ACL must stay associated with a distribution on a flat-rate plan. Checked
  2026-09-23.
- [AWS WAF FAQs](https://aws.amazon.com/waf/faqs/) and
  [one-click protections](https://aws.amazon.com/blogs/networking-and-content-delivery/mitigate-common-web-threats-with-one-click-in-amazon-cloudfront/)
  — covers:
  - Pay-as-you-go WAF is billed per web ACL, per rule and per request.
  - One-click protection is estimated at $14/month for 10M requests.

  Checked 2026-09-23.

- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/) — NAT gateway hourly plus
  per-GB charges (example: us-east-2 $0.045/hour and $0.045/GB). Checked 2026-09-23.
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
  and
  [an ALB example](https://aws.amazon.com/blogs/awsforsap/elevate-user-experience-and-security-of-application-load-balancer-for-sap-workloads-on-aws/)
  — ALB hourly plus LCU charges (example: us-east-1 $0.0225/hour and $0.008/LCU-hour).
  Checked 2026-09-23.
- [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/),
  [an interface endpoint example](https://docs.aws.amazon.com/solutions/latest/clickstream-analytics-on-aws/cost.html)
  and
  [gateway endpoints](https://docs.aws.amazon.com/eks/latest/best-practices/cost-opt-networking.html)
  — covers:
  - Interface endpoints bill per endpoint per AZ-hour (example: $0.01) plus $0.01/GB.
  - Gateway endpoints for S3 and DynamoDB are free.

  Checked 2026-09-23.

## Data

- [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/) and
  [the on-demand launch post](https://aws.amazon.com/blogs/aws/amazon-dynamodb-on-demand-no-capacity-planning-and-pay-per-request-pricing/)
  — on-demand bills per request with no capacity planning. Checked 2026-09-23.
- [Condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
  — conditional writes such as `attribute_not_exists(pk)`, which reject a write whose
  condition is false. Checked 2026-09-23.
- [A framework for DynamoDB transactions](https://aws.amazon.com/blogs/database/a-framework-for-amazon-dynamodb-transactions/)
  and
  [DynamoDB transactions launch post](https://aws.amazon.com/blogs/aws/new-amazon-dynamodb-transactions/)
  — a transaction holds at most 100 actions (since September 2022), and no two actions
  may target the same item. Checked 2026-09-23.
- [DynamoDB local usage notes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html)
  and
  [2019: the year in review for DynamoDB](https://aws.amazon.com/blogs/database/2019-the-year-in-review-for-amazon-dynamodb/)
  — DynamoDB local supports the transactional APIs and on-demand mode, but not
  point-in-time recovery. Checked 2026-09-23. The usage notes also cover what
  `packages/adapters` and its DynamoDB-local suite rely on:
  - DynamoDB local never throws a transaction conflict for the transactional APIs, so
    the adapter's handling of a `TransactionConflict` cancellation is tested against a
    fake rather than against DynamoDB local.
  - Its table names are case-insensitive, and its access key may hold only letters and
    digits.
  - `-inMemory` keeps no data across a restart.

  Checked 2026-09-23.

- [TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)
  and
  [TransactionCanceledException](https://docs.aws.amazon.com/botocore/latest/reference/services/dynamodb/client/exceptions/TransactionCanceledException.html)
  — a request carries 1 to 100 actions, no two on the same item; a cancelled one lists a
  reason per action in request order, `None` for an action that did not fail, and
  `ConditionalCheckFailed` or `TransactionConflict` among the others. Checked
  2026-09-23.
- [Telemetry in DynamoDB local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocalTelemetry.html)
  — `DDB_LOCAL_TELEMETRY=0` turns telemetry off, which `compose.yaml` and ci.yml's
  service container both set. Checked 2026-09-23.
- [Aurora DSQL FAQs](https://aws.amazon.com/rds/aurora/dsql/faqs/),
  [pricing](https://aws.amazon.com/rds/aurora/dsql/pricing/) and
  [billing](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html)
  — covers:
  - Billing is by DPU and storage; us-east-1 is $8 per 1M DPU and $0.33 per GB-month.
  - The free tier is 100,000 DPU and 1 GB-month per month.
  - An idle cluster consumes zero DPU.

  Checked 2026-09-23.

- [Aurora DSQL PostgreSQL compatibility](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html),
  [DSQL with Apache OFBiz](https://aws.amazon.com/blogs/database/up-and-running-with-apache-ofbiz-and-amazon-aurora-dsql/)
  and
  [DSQL with SQLAlchemy](https://aws.amazon.com/blogs/database/building-python-applications-with-sqlalchemy-and-aurora-dsql/)
  — covers:
  - Transactions:
    - Isolation is fixed at Repeatable Read.
    - A transaction modifies at most 3,000 rows.
    - Concurrency is optimistic, and a transaction that loses a conflict is retried from
      the start.
  - Supported: foreign keys, and IAM authentication tokens.
  - Not supported: `SAVEPOINT`.

  Checked 2026-09-23.

- [Aurora Serverless v2 scaling to zero](https://aws.amazon.com/blogs/database/introducing-scaling-to-0-capacity-with-amazon-aurora-serverless-v2/)
  — covers:
  - Supported versions can set a 0 ACU minimum and pause automatically.
  - Other versions have a 0.5 ACU minimum.

  Checked 2026-09-23.

- [Amazon OpenSearch Service pricing](https://aws.amazon.com/opensearch-service/pricing/)
  — covers:
  - OpenSearch Serverless classic collections need a minimum of 2 OCU.
  - NextGen collections scale to zero.
  - S3 Vectors bills per PUT, per GB-month stored, and per query.

  Checked 2026-09-23.

- [S3 Vectors general availability](https://aws.amazon.com/about-aws/whats-new/2025/12/amazon-s3-vectors-generally-available/)
  and
  [the query price reduction](https://aws.amazon.com/about-aws/whats-new/2026/06/s3-vectors-reduces-query-charges-80-percent-large-indexes/)
  — GA in December 2025, and query charges cut by up to 80% for large indexes. Checked
  2026-09-23.
- [Powertools for AWS Lambda (TypeScript) idempotency](https://docs.aws.amazon.com/powertools/typescript/2.27.0/api/modules/_aws-lambda-powertools_idempotency.html)
  and
  [idempotent Lambda functions](https://aws.amazon.com/blogs/compute/implementing-idempotent-aws-lambda-functions-with-powertools-for-aws-lambda-typescript/)
  — covers:
  - It offers `makeIdempotent`, a decorator and Middy middleware.
  - It persists state in DynamoDB.

  Checked 2026-09-23.

- AWS regional availability data, queried through the AWS documentation service —
  DynamoDB, Aurora DSQL and AWS Amplify are available in `ap-northeast-1`. Checked
  2026-09-23.

## Operations and cost

- [Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
  and [Free Tier FAQs](https://aws.amazon.com/free/free-tier-faqs/) — covers:
  - A Free plan ends after six months or when its credits run out, whichever comes
    first; an account not upgraded by then closes, and its content is kept for 90 days.
  - Upgrading to the Paid plan keeps the remaining credits.
  - Creating or joining an organization, or setting up a Control Tower landing zone,
    ends the credits at once and upgrades the account to the Paid plan.

  Checked 2026-09-23.

- [Sign in through the AWS CLI](https://docs.aws.amazon.com/signin/latest/userguide/command-line-sign-in.html)
  and
  [AWS Sign-In managed policies](https://docs.aws.amazon.com/signin/latest/userguide/security-iam-awsmanpol.html)
  — `aws login` (AWS CLI 2.32.0 or later) issues short-term credentials. An IAM identity
  needs `signin:AuthorizeOAuth2Access` and `signin:CreateOAuth2Token`, which
  `SignInLocalDevelopmentAccess` grants and `AdministratorAccess` already includes.
  Checked 2026-09-23.
- [IAM user and role access to Billing information](https://docs.aws.amazon.com/help-panel/awsaccountbilling/latest/console/hp-account-iam.html)
  — only the root user can activate it. It gates the Billing and Cost Management console
  pages, not the Budgets, Cost Explorer or Cost and Usage Reports APIs. Checked
  2026-09-23.
- [AWS Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/)
  and
  [Budgets actions](https://aws.amazon.com/blogs/aws-cloud-financial-management/get-started-with-aws-budgets-actions/)
  — covers:
  - Budgets without actions are free.
  - The first two budgets with actions are free, then each costs $0.10/day.
  - An action can apply an IAM policy or an SCP, automatically or after approval.

  Checked 2026-09-23.

- [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/) —
  $0.40 per
  secret per month, $0.05 per 10,000 API calls. Checked 2026-09-23.
- [Systems Manager pricing](https://aws.amazon.com/systems-manager/pricing/) and
  [the startup security baseline](https://docs.aws.amazon.com/prescriptive-guidance/latest/aws-startup-security-baseline/wkld-03.html)
  — covers:
  - Standard parameters (up to 4 KB) carry no additional charge.
  - Encryption with an AWS managed key is free.

  Checked 2026-09-23.

- [Parameters and Secrets Lambda extension](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html)
  — an HTTP cache on `localhost:2773`, with a TTL of 300 seconds by default and at most,
  holding up to 1,000 items. Checked 2026-09-23.
- [Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)
  and
  [Powertools Logger](https://docs.aws.amazon.com/powertools/python/2.36.0/core/logger/index.html)
  — `TZ` is a reserved runtime variable, and a Lambda function's default time zone is
  UTC. Checked 2026-09-23.
- [CloudFormation template reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/full.md)
  — once another stack imports an exported output, the exporting stack cannot be deleted
  and the exported value cannot be modified; `Fn::GetStackOutput` creates a weak
  reference that needs no export. Checked 2026-09-23.
- [Cost-effective Step Functions workflows](https://aws.amazon.com/blogs/compute/building-cost-effective-aws-step-functions-workflows/)
  and
  [What is Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
  — covers:
  - Standard workflows:
    - $0.025 per 1,000 state transitions, with 4,000 free per month.
    - Exactly-once execution, running up to one year.
  - Express workflows:
    - $1.00 per 1M executions plus duration.
    - At-least-once execution, up to five minutes.

  Checked 2026-09-23.

- [Step Functions and Bedrock](https://docs.aws.amazon.com/step-functions/latest/dg/connect-bedrock.html)
  — optimized integrations for `InvokeModel` and `CreateModelCustomizationJob`. Checked
  2026-09-23.

## Amazon Bedrock

- [Structured outputs on Bedrock](https://aws.amazon.com/blogs/machine-learning/structured-outputs-on-amazon-bedrock-schema-compliant-ai-responses/)
  — covers:
  - `outputConfig.textFormat` with `type: "json_schema"` on Converse.
  - It is GA in all commercial regions, for Anthropic among other providers.
  - It works with cross-region inference, batch inference and ConverseStream.

  Checked 2026-09-23.

- [Structured outputs with Amazon Nova](https://aws.amazon.com/blogs/machine-learning/structured-outputs-with-amazon-nova-a-guide-for-builders/)
  — a tool's `inputSchema` as an alternative way to obtain structured output. Checked
  2026-09-23.
- [JP cross-region inference for Claude Sonnet 4.5 and Haiku 4.5](https://aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-cross-region-inference-for-claude-sonnet-4-5-and-haiku-4-5-in-japan-and-australia/)
  — JP geo profiles route only between Tokyo and Osaka. Checked 2026-09-23.
- [Claude Haiku 4.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html)
  and
  [Claude Sonnet 4.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-5.html)
  — covers:
  - The profiles `jp.anthropic.claude-haiku-4-5-20251001-v1:0` and `global.` exist, and
    Sonnet 4.5 has `jp.` and `global.` profiles.
  - On-demand invocation requires a geo or global profile.

  Checked 2026-09-23.

- [Global cross-region inference for the latest Claude models](https://aws.amazon.com/blogs/machine-learning/global-cross-region-inference-for-latest-anthropic-claude-opus-sonnet-and-haiku-models-on-amazon-bedrock-in-thailand-malaysia-singapore-indonesia-and-taiwan/)
  — `global.anthropic.claude-sonnet-4-6` exists. Checked 2026-09-23.
- [Optimizing LLM costs on Bedrock](https://aws.amazon.com/blogs/aws-cloud-financial-management/optimize-llm-costs-on-amazon-bedrock-from-billing-attribution-to-operational-telemetry/)
  — covers these prices per 1M tokens:
  - Haiku 4.5: $1 input, $5 output.
  - Sonnet 4.5: $3 input, $15 output.
  - Sonnet 4.6: $0.30 for a cache read.

  Checked 2026-09-23.

- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) — batch inference at
  50% of on-demand for supported models, and the service tiers. Checked 2026-09-23.
- [Estimating Bedrock costs](https://aws.amazon.com/blogs/publicsector/how-to-estimate-amazon-bedrock-costs-for-public-sector-applications/)
  — prompt cache writes cost more than normal input, and cache reads cost less. Checked
  2026-09-23.
- [TokenUsage](https://docs.aws.amazon.com/sdk-for-kotlin/api/latest/bedrockruntime/aws.sdk.kotlin.services.bedrockruntime.model/-token-usage/index.html)
  — input, output, total, cache read and cache write token counts. Checked 2026-09-23.
- [Model invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)
  — covers:
  - Logs go to CloudWatch Logs and S3, in the same account and region.
  - Logging is off by default.

  Checked 2026-09-23.

- [Creating application inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-create.html),
  [cost allocation with them](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-mgmt-application-inference-profiles.html)
  and
  [CUR data](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-mgmt-understanding-cur-data.html)
  — covers:
  - Tagged profiles split cost by tag in Cost Explorer and the CUR.
  - Tags take up to 24 hours to appear, and apply only from activation onward.

  Checked 2026-09-23.

- [ApplyGuardrail](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-independent-api.html)
  and [Bedrock FAQs](https://aws.amazon.com/bedrock/faqs/) — covers:
  - ApplyGuardrail works without a model call, for `INPUT` or `OUTPUT`.
  - The `PROMPT_ATTACK` filter detects jailbreaks and prompt injection.

  Checked 2026-09-23.

- [Guardrails for code generation](https://aws.amazon.com/blogs/machine-learning/best-practices-for-applying-amazon-bedrock-guardrails-to-code-generation-workflows/)
  and
  [a 2024 guardrails post](https://aws.amazon.com/blogs/machine-learning/safeguard-a-generative-ai-travel-agent-with-prompt-engineering-and-amazon-bedrock-guardrails/)
  — covers:
  - A text unit is 1,000 characters.
  - The content filter counts as one unit, whatever the category.
  - The 2024 us-east-1 prices are historical only.

  Checked 2026-09-23.

- [LLM-as-a-judge](https://docs.aws.amazon.com/bedrock/latest/userguide/evaluation-judge.html)
  and
  [custom metrics](https://docs.aws.amazon.com/bedrock/latest/userguide/model-evaluation-custom-metrics-create-job.html)
  — covers:
  - Evaluation can run over your own inference responses (bring your own responses).
  - Custom metrics are defined with a prompt and a rating scale.

  Checked 2026-09-23.

- [Amazon Transcribe pricing](https://aws.amazon.com/transcribe/pricing/) — billing is
  per second, with no minimum charge, and prices vary by region. Checked 2026-09-23.

## Amazon Bedrock AgentCore and agents

- [AgentCore regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html)
  — Runtime, Memory, Gateway, Identity, built-in tools, Observability, Policy and
  Evaluations are available in Tokyo. Checked 2026-09-23.
- [AgentCore general availability](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-is-now-generally-available/)
  — AgentCore is generally available in nine regions, Tokyo among them. Checked
  2026-09-23.
- [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/) — covers:
  - Runtime per-second billing:
    - CPU is free during I/O wait.
    - v2 costs $0.1276 per vCPU-hour and $0.0169 per GB-hour.
    - There is no minimum fee.
  - Memory, Gateway and Identity prices.
  - The features still in preview.

  Checked 2026-09-23.

- [Inbound JWT authorizer](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/inbound-jwt-authorizer.html)
  — `CUSTOM_JWT` with a discovery URL, and allowed audiences, clients, scopes and custom
  claims. Checked 2026-09-23.
- [Runtime OAuth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html)
  — covers:
  - The request header allowlist passes `Authorization` to agent code.
  - The official sample reads claims without verifying the signature.

  Checked 2026-09-23.

- [Customer complaint classification with agents](https://aws.amazon.com/blogs/industries/automate-customer-complaint-classification-with-ai-agents-on-aws/)
  — under SigV4, the user id is passed in `X-Amzn-Bedrock-AgentCore-Runtime-User-Id`.
  Checked 2026-09-23.
- [Stateful MCP clients on Runtime](https://aws.amazon.com/blogs/machine-learning/introducing-stateful-mcp-client-capabilities-on-amazon-bedrock-agentcore-runtime/)
  — a dedicated microVM per session. Checked 2026-09-23.
- [Runtime lifecycle settings](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html)
  — covers:
  - A microVM session lives up to 8 hours, with a 15-minute idle timeout by default.
  - Instances run up to 14 days.

  Checked 2026-09-23.

- [Harness operations](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-operations.html)
  — memory is charged during I/O wait. Checked 2026-09-23.
- [CDK `aws_bedrockagentcore`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)
  — covers:
  - `PUBLIC` network mode, which needs no VPC.
  - Memory namespaces with `{actorId}`, `{sessionId}` and `{memoryStrategyId}`.

  Checked 2026-09-23.

- [TypeScript quick start](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html)
  — covers:
  - arm64 only, with a 250 MB compressed zip limit.
  - `agentcore dev` for local runs and `agentcore deploy` (CDK) for deploys.

  Checked 2026-09-23.

- [Node.js direct code deploy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html)
  — the HTTP contract is `/ping` and `/invocations` on port 8080. Checked 2026-09-23.
- [TypeScript SDK reference](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-typescript-sdk-reference.html)
  — `BedrockAgentCoreApp` and `context.sessionId`. Checked 2026-09-23.
- [AgentCore Memory](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/)
  — covers:
  - Short-term memory is stored as events.
  - Long-term memory uses strategies: semantic, summary, user preference and custom.

  Checked 2026-09-23.

- [AgentCore Gateway](https://aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-agentcore-gateway-transforming-enterprise-ai-agent-tool-development/)
  — covers:
  - Lambda, OpenAPI and Smithy targets become MCP tools.
  - Inbound authentication is OAuth; outbound is IAM, an API key or OAuth.

  Checked 2026-09-23.

- [AgentCore Identity](https://aws.amazon.com/blogs/machine-learning/secure-ai-agents-with-amazon-bedrock-agentcore-identity-on-amazon-ecs/)
  — workload access tokens, 3LO consent and the token vault. Checked 2026-09-23.
- [Policy GA](https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/)
  and
  [guardrails in policies](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-guardrails-in-policies.html)
  — covers:
  - Policy is written in Cedar and enforced at the Gateway.
  - Guardrails used within Policy are available in Tokyo.

  Checked 2026-09-23.

- [Evaluations GA](https://aws.amazon.com/about-aws/whats-new/2026/03/agentcore-evaluations-generally-available/)
  — covers:
  - GA on 2026-03-31, with online and on-demand evaluation.
  - 13 built-in evaluators, plus custom evaluators.

  Checked 2026-09-23.

- [Strands Agents TypeScript v1](https://strandsagents.com/blog/strands-agents-typescript-v1/index.md)
  — `@strands-agents/sdk` 1.0, with Bedrock as the default model provider. Checked
  2026-09-23.

## Libraries

- [Hono on AWS Lambda](https://hono.dev/docs/getting-started/aws-lambda) — `handle()`
  from `hono/aws-lambda`, response streaming with `streamHandle`, and a CDK deployment
  example. Checked 2026-09-23.
- [hono-openapi](https://github.com/rhinobase/hono-openapi) — OpenAPI documents
  generated from route validators and `describeRoute`. Checked 2026-09-23.
- [Hono, Zod OpenAPI](https://hono.dev/examples/zod-openapi) — routes declared with
  `createRoute()` and registered with `app.openapi()`, with `z` imported from
  `@hono/zod-openapi`. Checked 2026-09-23.
- [Zod, JSON Schema](https://zod.dev/json-schema) — `z.toJSONSchema()` introduced in Zod
  4.0; Draft 2020-12 as the default target, with `draft-04`, `draft-07` and
  `openapi-3.0` the others; a registry converted in one pass with `$ref`s shaped by the
  `uri` option; `additionalProperties` left unset in `io: "input"` mode. Checked
  2026-09-23.
- [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) — the Schema
  Object is JSON Schema Draft 2020-12, and a relative server URL resolves the paths
  under it. Checked 2026-09-23.
- [Vitest, Snapshot](https://vitest.dev/guide/snapshot) — `toMatchFileSnapshot`, and no
  snapshot written when `CI` is set, so a mismatched or missing one fails the run.
  Checked 2026-09-23.

## Unverified

Each item below is used somewhere in these documents, and none was confirmed by an
official source during the research. Treat each as an assumption to check before relying
on it.

- **Prices in Tokyo.** None of these were confirmed in `ap-northeast-1`; the documents
  quote other regions or unstated regions:
  - NAT gateway, ALB, VPC interface endpoints, OpenSearch Serverless OCU, Aurora ACU and
    S3 Vectors.
  - Amazon Transcribe streaming, and Bedrock on-demand prices through JP profiles.
  - API Gateway HTTP API, Lambda, and DynamoDB on-demand and PITR.
- **Amplify Hosting:** support for Next.js 16.
- **CloudFront flat-rate plans:** which WAF rules each tier allows, including rate-based
  rules.
- **Bedrock Guardrails:** availability in Tokyo, and the current price per text unit.
- **Claude on JP profiles:** which models newer than Sonnet 4.5 have a `jp.` inference
  profile.
- **Converse latency:** whether the response includes `metrics.latencyMs`.
- **Cognito email:** the limits of the built-in email sender, as opposed to Amazon SES.
- **App stores:**
  - App Store and Google Play rules for digital goods and subscriptions, and for
    pointing learners to web purchases.
  - Whether Sign in with Apple is required when other social sign-in options are
    offered.
- **API client generators:** Apple's `swift-openapi-generator` for the Swift client, and
  OpenAPI Generator for the Kotlin client.
- **OpenAPI `discriminator`:** whether those generators need one on a `oneOf` union to
  produce usable types ([ADR-0013](adr/0013-openapi-generated-from-zod-json-schema.md)).
- **SPA libraries:** TanStack Router, TanStack Query and next-intl's framework-agnostic
  core.
- **AgentCore:**
  - the npm package name of the TypeScript SDK
  - how Gateway conveys the caller's verified identity to a Lambda target
- **Unevaluated alternatives:**
  - payment options on AWS that could replace Stripe
  - a subscription aggregator that unifies store and web purchases
- **Budgets:** how far budget data lags behind actual spend.

## Internal sources

- This repository at commit `d2a5cd9` — the code references (`path:line`) in these
  documents are valid at that commit.
- The vocabulary prototype at commit `cc00b0e`, a separate repository started from the
  same template. It is summarized in [current-state.md](current-state.md). What these
  documents use from it:
  - its FSRS scheduler (ts-fsrs behind one pure module)
  - its review log with before and after states
  - its move from full-table reads to point lookups on the review path
