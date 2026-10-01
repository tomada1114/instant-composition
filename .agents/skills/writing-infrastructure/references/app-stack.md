# The `app` stack's decisions

What `infra/src/app-stack.ts` and the modules it calls have settled, and why. The values
themselves live in the code and `tests/infra-*.test.ts` assert them; this file holds
only the reasons an edit would otherwise undo.

## The distribution

- **One origin per path.** `/*` comes from the SPA bucket through origin access control
  (`S3BucketOrigin.withOriginAccessControl`), cached with `CachingOptimized`. The bucket
  blocks every kind of public access and admits only this distribution, over TLS.
  `/api/*` goes to the HTTP API's own `execute-api` domain, over HTTPS, uncached
  (`CachingDisabled`), with every method allowed.
- **`AllViewerExceptHostHeader` on `/api/*`.** The API needs what the viewer sent: the
  cookie path's `Origin` check, the session cookie, `Authorization`, and the sign-in
  callback's query string. `Host` alone is dropped, because API Gateway must see its own
  host name. The path goes through unchanged, so the app sees `/api/v1/...`, as it does
  behind the local Vite proxy.
- **The SPA fallback is a CloudFront Function**, on viewer request: a path whose last
  segment has no `.` is a client route and becomes `/index.html`. Never a
  distribution-wide error response instead — it would also rewrite the API's own `403`
  and `404` answers.
- **The `dev` URL is the distribution's default domain.** No custom domain or
  certificate exists; the `WebUrl` output carries it, and the API function's web origin
  and the hosted client's redirect URLs are derived from it in the same template.
- **On the flat-rate Free plan** (ADR-0009, Stages; #173).
  `AWS::PricingPlanManager::Subscription` covers the distribution and `edge`'s web ACL,
  which the distribution's `WebACLId` names. The subscription references the
  distribution, so CloudFormation creates it after the distribution and deletes it
  first: a subscribed distribution cannot be deleted. CloudFormation refuses a tier
  change on an existing subscription, so moving to Pro happens outside the stack first
  and `CLOUDFRONT_PLAN_TIER` follows.
- **Only what the Free plan admits** — AWS-managed cache and origin request policies,
  origin access control, one CloudFront Function, at most five cache behaviors — and
  never a custom cache, origin request or response headers policy, an origin access
  identity, legacy `ForwardedValues` or a real-time log config. The function and the web
  ACL serve this distribution alone. `tests/infra-app-stack.test.ts` holds that list. A
  change that needs one of them breaks the subscription, so it owes ADR-0009 an
  amendment and the owner's OK first.

## The HTTP API and the function

- The HTTP API has one route, `/{proxy+}` for every method, integrated with the function
  as a payload format 2.0 proxy on the auto-deployed `$default` stage. Routing is the
  app's own (`serving-the-api`), so an operation added to the contract needs no infra
  change. Only this HTTP API may invoke the function.
- **The bundle** (`infra/src/api-function.ts`): `NodejsFunction` builds
  `apps/api/src/lambda.ts` with esbuild, which is a root devDependency because the
  construct runs it in the project root it is given — the repository root — and falls
  back to Docker without it. The output is ESM for Node 24 on arm64. The AWS SDK is
  bundled at the lockfile's version rather than taken from the runtime, so the function
  runs what the tests ran. The catalog snapshot is built from `content/` into the bundle
  after bundling, at `LAMBDA_CATALOG_PATH`, so a deploy never ships a catalog older than
  the checkout it bundles.
- **The environment.** The function is given every hosted name `readHostedEnv` requires
  but the ones Lambda sets itself. The client id is the hosted client's, not
  `foundation`'s `web-client-id` parameter; the secret enters only as its parameter's
  name.
- **The Parameters and Secrets extension layer is pinned by ARN**
  (`PARAMETERS_EXTENSION_LAYER_ARN`), because aws-cdk-lib's own version table stops at a
  2023 release. The layer must match the function's architecture and Region. Bumping it
  means checking AWS's published list for `ap-northeast-1` arm64 and updating the date
  in its TSDoc.
- **Its role** may read and write the learner table, `ssm:GetParameter` the one secret
  parameter, and `kms:Decrypt` only through Parameter Store for that one parameter's
  encryption context; beyond that, only writing its own logs. Nothing runs in a VPC.
- The function waits on the secret writer (`handler.node.addDependency`), so a replaced
  client's function never starts before its new secret is in Parameter Store.

## The hosted web app client and its secret

- **The client** (`addHostedWebClient`, `infra/src/web-client.ts`) sits on
  `foundation`'s user pool, read by id from Parameter Store, with its own Cognito
  managed login style and `foundation`'s domain. Its settings come from the same
  `webClientOptions` as `foundation`'s local client, so the two differ only in their
  redirect URLs; change a setting there, never in one caller.
- **The secret** is copied into the `SecureString` `webClientSecretParameterName(stage)`
  by `Custom::WebClientSecret` (`infra/src/web-client-secret.ts`), because
  CloudFormation cannot write a `SecureString` and a plain `String` would put the secret
  in the template. It runs on every create and update, and a replaced client changes
  `ClientId`, so the new secret is written in the same deploy. The stack creates no
  `AWS::SSM::Parameter`, and the secret never reaches a template, a property, an output
  or a log line.
- **Inline Python, not `AwsCustomResource`.** CDK's `AwsCustomResource` logs every event
  whole, and a second call's parameters would carry the secret. The handler is inline
  Python on the runtime's own boto3 — nothing bundled, within CloudFormation's 4096-byte
  inline limit, which a test checks — and reads and writes the secret inside one
  invocation. A failure reports the error's code alone, since an SDK message may quote a
  request's values.
- **Keep its construct ids stable.** A renamed resource is created anew and the old one
  deleted afterwards, and that Delete would remove the parameter the new one had just
  written. The handler removes the parameter on Delete only when it is the one this
  resource wrote.
- The writer may describe the one client's pool, put and delete the one parameter, and
  `kms:Encrypt` only through Parameter Store for it.

How the API reads the secret at run time is `authenticating-learners`'.

## The alarms

- ADR-0009's baseline, sized to CloudWatch's free tier (ADR-0009's cost table holds the
  limits): single-metric alarms on the HTTP API's 5xx, the function's errors and
  throttles, and the table's read and write throttles, and one dashboard of traffic,
  errors and latency. `tests/infra-observability.test.ts` holds the count and that no
  alarm is a metric-math one, so a new alarm or dashboard is weighed against the free
  tier before that test changes.
- Each alarm fires on a single event in one one-minute period, and missing data — what a
  minute without traffic produces — counts as not breaching.
- Every alarm notifies one SNS topic. Its email subscription exists only when a deploy
  passes `alarm-email`; the address is never committed ("Deploying" in `SKILL.md`).
- The topic carries a topic policy, which replaces SNS's default one. It admits
  CloudWatch alarms and AWS Budgets by name, one statement each, so a new publisher
  needs its own statement or its messages are dropped.
- The Bedrock budget (`addBedrockBudget` in `infra/src/bedrock-budget.ts`, ADR-0010)
  notifies the same topic and, once actual Bedrock spend reaches the limit, attaches a
  policy denying model invocation to every role in its `roles`. Any function that calls
  Bedrock joins `roles` — #279's worker role among them — or the backstop does not stop
  it.
- The table's metrics are dimensioned by the name read from Parameter Store, so the
  alarms stay in `app` although the table is `foundation`'s.
