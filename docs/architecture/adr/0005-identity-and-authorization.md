# ADR-0005: Identity and authorization

- Status: Accepted (2026-09-23)
- Date: 2026-09-23
- Deciders: the owner

## Context

Today the application has no learner concept at all:

- Settings are one row (`CHECK (id = 1)`, `src/server/db/migrations.ts:10`), and no
  table has a learner column.
- `getRound(id)` reads any round by id (`src/server/db/rounds.ts:75-78`). In a
  multi-learner store, that shape would let one learner read another's round.
- The only credential is an optional shared bearer secret, `API_ACCESS_KEY`
  (`src/server/env.ts:55`). The wiring requires it for endpoints that bill a provider
  (`src/server/env.ts:75-91`).
- `src/proxy.ts:34-36` excludes `api` paths, so route handlers have nothing in front of
  them.

The owner has decided:

- Authentication uses Amazon Cognito, and local development authenticates against it
  too.
- The service is public, with self sign-up.
- Web, iOS/macOS and Android are all clients of one API
  ([ADR-0001](0001-server-owned-logic-behind-one-api.md)).
- Authorization is a separate concern from authentication. It decides who may act on
  whose data, including, later, an agent acting on a learner's behalf
  ([ADR-0012](0012-agents-and-agentcore.md)).

## Decision drivers

- A learner can never read or change another learner's data. This must be tested, not
  assumed.
- One authentication path for four clients.
- No long-lived token readable by page JavaScript on the web.
- Local development and tests must not depend on a network call per test.
- Keep fixed costs near zero until abuse is observed.

## Considered options

- **Web session handling.**
  - (a) The SPA holds tokens itself as a public client.
  - (b) API-hosted auth endpoints act as a small backend-for-frontend and keep tokens in
    HttpOnly cookies.

  (b) is chosen: tokens never reach page scripts, and the API already exists.

- **Where the JWT is verified.**
  - (a) Only at API Gateway's JWT authorizer.
  - (b) In the application, with the authorizer optional.

  (b) is chosen, because the cookie path cannot use API Gateway's JWT authorizer and one
  verification path is easier to test.

- **Identifier.** Use Cognito's `sub` as the primary key, or an internal LearnerId
  mapped to it. The internal id is chosen, so that adding an identity provider or
  linking accounts never rewrites data keys.

## Decision

### Authentication

- Cognito user pool on the Essentials plan. Lite and Essentials include 10,000 MAU per
  month at no charge, and Essentials adds features that Lite lacks, such as access-token
  customization (as of 2026-09-23).
- Self sign-up with email verification.
- **Web.** A confidential app client. The API hosts `/v1/auth/login`, `/callback`,
  `/refresh` and `/logout`. They run the authorization code flow with PKCE (S256), keep
  the client secret server-side, and set HttpOnly, Secure, SameSite=Lax cookies.
- **Native apps.** Public app clients running the authorization code flow with PKCE
  through the system browser. They send `Authorization: Bearer <access token>`.
- **Refresh.** Refresh-token rotation is enabled. It requires refreshing through
  `GetTokensFromRefreshToken` and is incompatible with the `REFRESH_TOKEN_AUTH` flow,
  which is therefore disabled on the app clients.

### One Authenticator port

```ts
// packages/application
interface Authenticator {
  authenticate(request: Request): Promise<Result<Principal, AuthError>>;
}
// Bearer header (native) or session cookie (web), resolved by the same code.
```

- The Cognito adapter verifies access tokens with `aws-jwt-verify`, using
  `tokenUse: "access"` and the expected `clientId`. AWS's guidance states that the
  audience must be checked.
- The identity context maps `sub` to LearnerId, creating the learner on first sign-in.
- The HTTP adapter builds `RequestContext` once per request:

```ts
interface RequestContext {
  readonly actor: Actor; // { kind: "learner", learnerId } | { kind: "system", job } |
  //                       { kind: "agent", onBehalfOf: LearnerId, grants }
  readonly learner: {
    readonly id: LearnerId;
    readonly timezone: string;
    readonly l1: string;
  };
  readonly now: number;
  readonly requestId: string;
}
```

### Authorization

Authorization happens at two levels, and both are required.

1. **Structural isolation.** Stores are obtained as `stores.forLearner(ctx.learner.id)`.
   No store method takes a learner id, and the adapter adds it to every key
   ([ADR-0006](0006-persistence-on-dynamodb.md)). A service has no way to express a
   cross-learner read.
2. **Policy.** `authorize(actor, command)` is one function over a table of actor kinds
   and commands. For a learner acting on their own data it is trivial. It matters for
   `system` jobs and for `agent` actors, whose grants are narrower than the learner's.

### Tests

- One isolation contract, run against every store adapter: write as learner A, then call
  every read as learner B and expect nothing back.
- At the HTTP level, B's token on A's round id returns 404, not 403, so an id's
  existence does not leak.
- An `authorize` table test that enumerates every actor and command pair.

### Web-specific protections

- The cookie path checks the `Origin` header on state-changing requests, as CSRF
  protection alongside SameSite.
- The Bearer path does not read cookies, so native clients are unaffected.

### Abuse and cost

- Cognito's threat protection (adaptive authentication, account-takeover response)
  requires the Plus plan: $0.020 per MAU with no free tier, as of 2026-09-23. It is
  deferred until abuse is observed.
- Throughput limits stay at the edge
  ([ADR-0009](0009-aws-topology-environments-and-operations.md)). Per-learner spending
  limits belong to the ledger ([ADR-0010](0010-entitlements-and-billing.md)).
  `API_ACCESS_KEY` is retired.

### Local development

- A real development user pool, with an app client whose callback is
  `http://localhost:<port>/...`. Cognito permits http only for `localhost`, `127.0.0.1`
  and `[::1]`.
- Tests never call Cognito. They sign JWTs with a local key pair and give the verifier
  that key set, so the production verification code runs in tests.
- No official Cognito emulator was found. LocalStack is third-party and is not relied
  on.

## Consequences

### Positive

- Every client and every future actor kind goes through the same two checks.
- Cross-learner access is impossible to write by accident, and the contract test proves
  it for each adapter.
- No token is readable by web page JavaScript.

### Negative

- The API owns the web login flow, including cookie handling, CSRF checks and refresh
  timing, instead of delegating it to a library-managed SPA client.
- The two credential carriers must stay behaviorally identical, which adds test cases.
- The LearnerId mapping costs one lookup per request (cacheable per token).

### Follow-ups

- Replace `API_ACCESS_KEY` and the `requiresAccessKey` rule with this port. Keep the
  invariant it expressed: an endpoint that bills a provider can never be wired open.
- Record the dev user pool's non-secret identifiers in configuration
  ([ADR-0009](0009-aws-topology-environments-and-operations.md)), never in this
  repository.

## Open questions

- Social identity providers and Sign in with Apple. Unverified: whether App Store rules
  require Sign in with Apple when other social logins are offered.
- Whether API Gateway's JWT authorizer should also pre-screen Bearer requests as a cheap
  first gate. HTTP APIs support a JWT authorizer configured with a Cognito issuer and
  audience.
- Where learner profile data lives: Cognito attributes or the identity context's own
  records. The current lean is own records, because they are portable and exportable.
- Unverified: the default email sending limits of a Cognito user pool, which decide
  whether Amazon SES is needed at launch.

## Sources

AWS documentation, checked 2026-09-23:

- Feature plans:
  https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html
- Pricing and free tier: https://aws.amazon.com/cognito/pricing/
- PKCE:
  https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html
- App clients and client secrets:
  https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html
- Security best practices:
  https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-security-best-practices.html
- Callback URLs (http allowed for localhost):
  https://docs.aws.amazon.com/sdk-for-ruby/v3/api/Aws/CognitoIdentityProvider/Types/CreateUserPoolClientRequest.html
- Verifying JWTs with `aws-jwt-verify`:
  https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html
- Refresh-token rotation:
  https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html
- Pre token generation (access-token customization plans):
  https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
- Threat protection (Plus):
  https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-settings-threat-protection.html
- HTTP API JWT authorizer:
  https://docs.aws.amazon.com/apigatewayv2/latest/api-reference/apis-apiid-authorizers.html
- LocalStack as a third-party emulator:
  https://docs.aws.amazon.com/lambda/latest/dg/testing-guide.html

## Related

- [ADR-0006](0006-persistence-on-dynamodb.md) — learner-bound stores
- [ADR-0007](0007-http-api-contract-and-offline-sync.md) — auth endpoints in the
  contract
- [ADR-0010](0010-entitlements-and-billing.md) — spending limits
- [ADR-0012](0012-agents-and-agentcore.md) — agent actors
