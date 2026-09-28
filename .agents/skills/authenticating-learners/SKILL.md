---
name: authenticating-learners
description: >
  Covers how this repository authenticates a learner: the Bearer and session-cookie
  credential paths, the __Host- cookies and their settings, the /v1/auth/ login,
  callback, refresh and logout endpoints with PKCE and the state cookie, when the local
  stand-in runs instead of Cognito, the API_COGNITO_* names a local run reads and where
  they come from, the client secret on Lambda, and how tests sign tokens. Use when
  sign-in, refresh or sign-out changes or fails, a cookie or token is added, the
  callback answers ERR_FORBIDDEN, or a local run needs a user pool.
---

# Authenticating Learners

**Owns:** the decisions this repository has made about authentication — which credential
goes where, the cookies, the web sign-in endpoints, which authenticator runs where, how
a local run and the hosted entry get the pool's settings, and how tests stand in for
Cognito. **Does not own:** the isolation rules identity serves — verify before trusting,
the internal `LearnerId`, 404 for another learner's resource (`isolating-learner-data`);
the handler table, log line and environment rules of `apps/api` (`serving-the-api`); the
user pool, the local and hosted web app clients, the secret's parameter and their stage
settings (`writing-infrastructure`); why Cognito and a backend-for-frontend (ADR-0005,
and ADR-0009 for secrets). General Cognito and OAuth knowledge stays with AWS's
documentation and AWS's own skills.

## Two credentials, one authenticator

`cognitoAuthenticator` (`apps/api/src/cognito-authenticator.ts`) accepts a Cognito
access token on either of two paths and yields the same `Principal`, the token's `sub`:

- **Bearer**, for a native client: `Authorization: Bearer <token>`. A request that
  carries an `Authorization` header is judged by it alone — a malformed one is
  `ERR_UNAUTHENTICATED`, never a fallback to a cookie — and needs no `Origin` check,
  since it carries no ambient credential.
- **The session cookie**, for the web client: `SESSION_COOKIE`, `__Host-access-token`.
  Every method but `GET`, `HEAD` and `OPTIONS` must carry an `Origin` among the web
  origins the authenticator is handed, or it is `ERR_FORBIDDEN` before the token is
  verified.

A token that does not verify is `ERR_UNAUTHENTICATED`; a key set that cannot be fetched
throws, a bare 500, since it is not the caller's fault. The verification settings
themselves are `isolating-learner-data`'s rule.

## The cookies

The browser never holds a token a page script can read. `apps/api/src/cookies.ts` sets
every cookie `Path=/; HttpOnly; Secure; SameSite=Lax` with an explicit `Max-Age`, and
every name is `__Host-` prefixed, which is why none can take a narrower path or a
`Domain`:

| Cookie                 | Holds                                          | Kept for                     |
| ---------------------- | ---------------------------------------------- | ---------------------------- |
| `__Host-access-token`  | The access token                               | The token's own `expires_in` |
| `__Host-refresh-token` | The refresh token, replaced on every rotation  | 30 days, the client default  |
| `__Host-sign-in`       | One sign-in's `state` and PKCE verifier, `a.b` | 10 minutes, login → callback |

A token is kept only when it fits a cookie (`COOKIE_SAFE_TOKEN` in
`apps/api/src/token-endpoint.ts`); one that does not is the pool's fault, not the
learner's.

## The web sign-in endpoints

`apps/api/src/cognito-web-session.ts` serves four endpoints over the confidential web
app client, listed with their log `operation` in `WEB_SESSION_ROUTES`
(`apps/api/src/web-session.ts`). They are **not** in contracts' `ROUTES` and not in
`openapi.json`: three answer a browser navigation with a redirect rather than JSON, and
none signs a learner in — the next API call does. `createApp` mounts them only when
handed a `webSession`, so with the stand-in they answer a bare 404.

- `GET /v1/auth/login` redirects to the managed login's `/oauth2/authorize` with
  `scope=openid`, a fresh 32-byte `state` and an S256 challenge of a fresh 32-byte
  verifier (`apps/api/src/pkce.ts`), both kept in `__Host-sign-in`.
- `GET /v1/auth/callback` is a top-level navigation from Cognito's domain and carries no
  `Origin`, so its CSRF check is the `state`, compared in constant time with the sign-in
  cookie's: missing or different is `ERR_FORBIDDEN`. It redeems the code with the
  verifier and the client secret, sent as HTTP Basic to `/oauth2/token`, sets both
  session cookies and redirects to `/`. It drops the sign-in cookie whether it succeeds
  or refuses.
- `POST /v1/auth/refresh` renews through the `refresh_token` grant and answers `204`
  with the new access token and the rotated refresh token.
- `POST /v1/auth/logout` revokes the refresh token through `/oauth2/revoke` (a failure
  there still signs out), drops both session cookies and answers `303` to the managed
  login's `/logout`.

`/refresh` and `/logout` change state from a page, so a missing or foreign `Origin` is
`ERR_FORBIDDEN` before anything is read. A grant the pool refuses (`invalid_grant`) is
`ERR_UNAUTHENTICATED`, and a refused refresh also drops the session's cookies. Any other
answer from the pool throws `TokenEndpointError` (`ERR_API_TOKEN_ENDPOINT`), a bare 500
whose log line names the class alone. Every call to the pool gives up after 10 seconds.

The web client (`apps/web/src/lib/api-call.ts`) answers an `ERR_UNAUTHENTICATED` by
posting to `/refresh` once and retrying; when that does not answer `204`, or the retry
is refused too, it navigates to `/api/v1/auth/login`. Sign-out is a top-level form post,
because the answer is a redirect to another origin. **REQUIRED:** `building-web-screens`
before changing either.

## Which authenticator runs where

| Entry                | Authenticator                   | Web origins and redirect URLs             |
| -------------------- | ------------------------------- | ----------------------------------------- |
| `main.ts`, pool set  | `cognitoAuthenticator`          | `LOCAL_WEB_ORIGINS`, `LOCAL_SIGN_IN_URLS` |
| `main.ts`, no pool   | `localAuthenticator` (stand-in) | none; `/v1/auth/*` is not mounted         |
| `lambda.ts` (hosted) | `cognitoAuthenticator`, always  | `API_WEB_ORIGINS`, `API_WEB_*_URL`        |

The stand-in (`apps/api/src/local-authenticator.ts`) makes every request
`LOCAL_SUBJECT`, whose learner the directory registers on the first request like any
first sign-in. It authenticates nothing, so it is reachable only from this machine:
`localRunAuthenticator` (`apps/api/src/local-run-authenticator.ts`) wires it only when
every `API_COGNITO_*` name is unset, `main.ts` listens on `127.0.0.1` alone, and
`readApiEnv` refuses to start (`ERR_API_ENV_NOT_LOCAL`) where
`AWS_LAMBDA_FUNCTION_NAME`, `AWS_EXECUTION_ENV` or `ECS_CONTAINER_METADATA_URI` is set.
The hosted app cannot wire it at all: `HostedDependencies` has no `authenticator` field.
The start-up line names which one ran, `"authenticator":"cognito"` or `"local"`.

`LOCAL_WEB_ORIGINS` names the page's origins (`127.0.0.1:5173` and `:4173`) because both
Vite servers proxy `/api` with the Host rewritten, so a request's own origin is never
the page's. `LOCAL_SIGN_IN_URLS` must stay equal to `dev`'s `WEB_CLIENT` in
`infra/src/foundation-stack.ts`, or Cognito refuses the redirect.

## A local run against the dev pool

The four `API_COGNITO_*` names are set together or not at all; a partial set stops the
start with `ERR_API_ENV_INVALID` naming the blank ones. No `.env` file is loaded, so
they are exported in the shell that runs `pnpm dev` or `pnpm api`. Three are outputs of
the `dev` foundation stack; the client secret is never an output and comes from Cognito
itself, straight into the variable so it is never printed:

```sh
stack=instant-composition-dev-foundation
out() { aws cloudformation describe-stacks --region ap-northeast-1 --stack-name "$stack" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
export API_COGNITO_USER_POOL_ID="$(out UserPoolId)"
export API_COGNITO_CLIENT_ID="$(out WebClientId)"
export API_COGNITO_DOMAIN="$(out SignInDomainUrl)"
export API_COGNITO_CLIENT_SECRET="$(aws cognito-idp describe-user-pool-client \
  --region ap-northeast-1 --user-pool-id "$API_COGNITO_USER_POOL_ID" \
  --client-id "$API_COGNITO_CLIENT_ID" --query UserPoolClient.ClientSecret --output text)"
```

Never write the secret into a file, tracked or not. `dev` has no self sign-up, so a
learner there is one an administrator created (`writing-infrastructure`).

**Sign in locally with Chrome or Firefox, not Safari** (the owner's decision,
2026-09-28). Safari does not keep a `Secure` cookie over plain `http://127.0.0.1`, so
`__Host-sign-in` is gone when the managed login sends the browser back and the callback
answers `ERR_FORBIDDEN`. That is the `state` check working, not a defect to route
around: never drop `Secure` or the `__Host-` prefix for a local run. Safari is checked
on the HTTPS dev URL in Phase 4 (#160).

## The hosted entry's configuration

`readHostedEnv` (`apps/api/src/env.ts`) requires the pool's id, the client id, the
domain, `API_COGNITO_CLIENT_SECRET_PARAMETER` and the three `API_WEB_*` names, and
refuses `API_COGNITO_CLIENT_SECRET`: on Lambda the secret never enters as a plain
variable. It is a Parameter Store `SecureString`, read by `readSecureString`
(`apps/api/src/parameters-extension.ts`) through the AWS Parameters and Secrets Lambda
extension on `localhost:2773`, with the function's `AWS_SESSION_TOKEN` as
`X-Aws-Parameters-Secrets-Token`. `hostedWebSession` (`apps/api/src/hosted.ts`) asks for
it on every sign-in endpoint call rather than holding it, so a rotated secret reaches a
warm function within the extension's 300-second cache. A failed read, a parameter that
is not a `SecureString`, or a value that is no client secret throws
`SecretParameterError` (`ERR_API_SECRET_UNREADABLE`), a bare 500. Neither the secret nor
the session token ever reaches an error, a log line or a response.

On `dev`, the client is the `app` stack's hosted web app client, redirecting to the
distribution's URL, and its secret is copied into the parameter by the stack's
`Custom::WebClientSecret`; `writing-infrastructure` holds both, and the names the stack
sets.

## Tests never call Cognito

- `tests/cognito-tokens.ts` generates an RS256 key and signs access tokens shaped as the
  pool issues them; the test hands `keySetOf(...)` to the authenticator as `keySet`, so
  the real `aws-jwt-verify` path runs and no JWKS is fetched.
- `tests/web-session-harness.ts` is a fake user pool domain answering `/oauth2/token`
  and `/oauth2/revoke` by the pool's rules — client secret checked, a code redeemable
  once and only with the verifier behind its S256 challenge, refresh tokens rotated —
  and a browser that keeps the cookies the API sets.
- `tests/api-lambda.test.ts` adds a fake extension on `localhost:2773`.

A test that needs a token signs one this way; it never reads a real pool's id, secret or
domain from the shell.
