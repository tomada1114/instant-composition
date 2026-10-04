---
name: authenticating-learners
description: >
  Covers how this repository authenticates a learner: the Bearer and session-cookie
  paths, the __Host- cookies, the web client's own /login page and the /v1/auth/ login
  (InitiateAuth, USER_PASSWORD_AUTH, SECRET_HASH), refresh and logout endpoints, when
  the local stand-in runs instead of Cognito, the API_COGNITO_* names, the client secret
  on Lambda, and how tests fake the pool. Use when sign-in, refresh or sign-out changes
  or fails, a cookie or token is added, a sign-in answers ERR_SIGN_IN_ACTION_REQUIRED,
  or a local run needs a user pool.
---

# Authenticating Learners

**Owns:** the decisions this repository has made about authentication — which credential
goes where, the cookies, the web sign-in endpoints, which authenticator runs where, how
a local run and the hosted entry get the pool's settings, and how tests stand in for
Cognito. **Does not own:** the isolation rules identity serves — verify before trusting,
the internal `LearnerId`, 404 for another learner's resource (`isolating-learner-data`);
the handler table, log line and environment rules of `apps/api` (`serving-the-api`); the
user pool, the local and hosted web app clients, the secret's parameter and their stage
settings (`writing-infrastructure`); why Cognito and a backend-for-frontend
(`mapping-the-architecture`). General Cognito and OAuth knowledge stays with AWS's
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

| Cookie                 | Holds                                         | Kept for                     |
| ---------------------- | --------------------------------------------- | ---------------------------- |
| `__Host-access-token`  | The access token                              | The token's own `expires_in` |
| `__Host-refresh-token` | The refresh token, replaced on every rotation | 30 days, the client default  |

A token is kept only when it fits a cookie (`COOKIE_SAFE_TOKEN` in
`apps/api/src/token-endpoint.ts`); one that does not is the pool's fault, not the
learner's.

## The web sign-in endpoints

The browser signs in on the web client's own page, `/login`, inside the shell's frame
(`designing-ui`); it never leaves for Cognito's managed login. The page posts the email
and password to the API on its own origin, and the API alone talks to Cognito with the
client secret. `apps/api/src/cognito-web-session.ts` serves three endpoints over the
confidential web app client, listed with their log `operation` in `WEB_SESSION_ROUTES`
(`apps/api/src/web-session.ts`). They are **not** in contracts' `ROUTES` and not in
`openapi.json`: they answer with cookies and a redirect rather than a learner's data,
and none signs a learner in to the directory — the next API call does. `createApp`
mounts them only when handed a `webSession`, so with the stand-in they answer a
bare 404.

- `POST /v1/auth/login` (`signIn`) takes `{ "email", "password" }` as JSON (at most 320
  and 256 characters; anything else is `ERR_BAD_REQUEST`, unsent). It calls the pool
  API's `InitiateAuth` (`apps/api/src/initiate-auth.ts`) at
  `https://cognito-idp.<region>.amazonaws.com/`, the region read from the pool id, with
  `USER_PASSWORD_AUTH`, the email as `USERNAME`, the password as typed, and
  `SECRET_HASH` = Base64(HMAC-SHA256(client secret, username + client id)). Tokens set
  both session cookies and answer `204`. `NotAuthorizedException` or
  `UserNotFoundException` is `ERR_UNAUTHENTICATED`; a challenge (`NEW_PASSWORD_REQUIRED`
  for a temporary password, or any other), `PasswordResetRequiredException` or
  `UserNotConfirmedException` is `ERR_SIGN_IN_ACTION_REQUIRED` — an administrator must
  act in the pool first (`AdminSetUserPassword` with `Permanent`), and the challenge's
  `Session` is dropped. No refusal sets or clears a cookie. Any other answer, a throttle
  included, throws `InitiateAuthError` (`ERR_API_INITIATE_AUTH`), a bare 500 whose log
  line names the class alone.
- `POST /v1/auth/refresh` renews through the domain's `/oauth2/token` `refresh_token`
  grant, the client secret sent as HTTP Basic, and answers `204` with the new access
  token and the rotated refresh token. A refresh token `InitiateAuth` issued renews
  there too, since the pool remembers no devices.
- `POST /v1/auth/logout` revokes the refresh token through `/oauth2/revoke` (a failure
  there still signs out), drops both session cookies and answers `303` to `/login`, the
  web client's own page on the same origin.

Every endpoint changes state from a page, so a missing or foreign `Origin` is
`ERR_FORBIDDEN` before anything is read or sent to the pool. A refresh grant the pool
refuses (`invalid_grant`) is `ERR_UNAUTHENTICATED`. A refused refresh leaves cookies
alone: a late refusal cannot delete cookies another tab successfully rotated. Explicit
logout drops them. Any other answer from the domain throws `TokenEndpointError`
(`ERR_API_TOKEN_ENDPOINT`), a bare 500. Every call to the pool gives up after 10
seconds. The password, the email and the secret hash reach no response, no error and no
log line. The domain stays configured, and so does the client's code grant: refresh and
revoke run there, though no page redirects to the managed login any more.

The sign-in page (`apps/web/src/login/`) posts through `signInWith`
(`apps/web/src/lib/sign-in.ts`), a plain `fetch`, never `send`: a refused password is an
answer for the form, never a 401 for the shared renewal to refresh or a reason to send
the browser to sign in again. It takes no second sign-in while one is out, says a
refusal, an account needing an administrator, or no answer under the fields, and on
`204` navigates to `/` with a full page load, which starts a fresh visit. The page reads
home beside the form only to send a visitor already signed in on to `/`; its frame never
waits for that read. Nothing in the form or the endpoint names a particular account, so
the same page serves whoever the pool admits — self sign-up stays off in `dev`, and a
learner there is one an administrator created.

The web client (`apps/web/src/lib/api-call.ts`) shares one renewal per tab, including
late initial refusals. `session-renewal.ts` serializes cookie changes across tabs with
Web Locks; local storage carries only a random revision hint, never a credential or an
authentication decision. Success retries each original request once. A terminal refusal
also probes the original once with current cookies before sending an established visit
to login. Temporary failures, including unreadable or unexpected refresh responses,
return `ERR_NETWORK` and keep answers queued for retry; a missing refresh endpoint is
the local stand-in's terminal refusal. An established visit whose renewal is refused
goes to `/login` (`LOGIN_URL`) by a full-page navigation. Browsers without Web Locks
fail closed as unavailable before renewing; explicit native logout remains usable.
Already-loaded older clients may still overlap, but refused renewals never delete
cookies.

Sign-out waits for renewal, then submits its top-level form under that same lock until
pagehide; the redirect lands on `/login`. Earlier calls cannot sign the visit back in or
replay after sign-out begins. Inside the auth lock, native submission takes the
vocabulary storage lock: successful submission immediately invalidates the learner
storage revision and removes private outboxes and checkpoints in that same turn, before
pagehide. The storage lock is released before waiting for pagehide; a failed native
submit retains every learner byte and permits another attempt. Late old outbox drains
cannot recreate data under the new revision. The origin epoch is initialized before
queues can share it; if initialization cannot persist, observations fail closed. A quota
failure while replacing the epoch falls back to deleting it, and private-data cleanup
runs independently of that write. **REQUIRED:** `building-web-screens` before changing
either.

## Which authenticator runs where

| Entry                | Authenticator                   | Web origins                       |
| -------------------- | ------------------------------- | --------------------------------- |
| `main.ts`, pool set  | `cognitoAuthenticator`          | `LOCAL_WEB_ORIGINS`               |
| `main.ts`, no pool   | `localAuthenticator` (stand-in) | none; `/v1/auth/*` is not mounted |
| `lambda.ts` (hosted) | `cognitoAuthenticator`, always  | `API_WEB_ORIGINS`                 |

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
the page's. With the stand-in, `/login` finds the visitor signed in already — home
answers — and goes on to `/`; a sign-in posted there anyway meets the unmounted
endpoint's 404 and says no answer came.

## A local run against the dev pool

The four `API_COGNITO_*` names are set together or not at all; a partial set stops the
start with `ERR_API_ENV_INVALID` naming the blank ones. They are exported in the shell
that runs `pnpm dev` or `pnpm api`, or kept in the gitignored `.env.local`, which those
two let Node load (`--env-file-if-exists`). Three are outputs of the `dev` foundation
stack; the client secret is never an output and comes from Cognito itself, straight into
the variable so it is never printed:

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
the session cookies `POST /v1/auth/login` sets are gone before the next read, and the
page stays signed out. That is the `__Host-` prefix working, not a defect to route
around: never drop `Secure` or the prefix for a local run. Safari works on the HTTPS dev
URL.

## The hosted entry's configuration

`readHostedEnv` (`apps/api/src/env.ts`) requires the pool's id, the client id, the
domain, `API_COGNITO_CLIENT_SECRET_PARAMETER` and `API_WEB_ORIGINS`, and refuses
`API_COGNITO_CLIENT_SECRET`: on Lambda the secret never enters as a plain variable. It
is a Parameter Store `SecureString`, read by `readSecureString`
(`apps/api/src/parameters-extension.ts`) through the AWS Parameters and Secrets Lambda
extension on `localhost:2773`, with the function's `AWS_SESSION_TOKEN` as
`X-Aws-Parameters-Secrets-Token`. `hostedWebSession` (`apps/api/src/hosted.ts`) asks for
it on every sign-in endpoint call rather than holding it, so a rotated secret reaches a
warm function within the extension's 300-second cache. A failed read, a parameter that
is not a `SecureString`, or a value that is no client secret throws
`SecretParameterError` (`ERR_API_SECRET_UNREADABLE`), a bare 500. Neither the secret nor
the session token ever reaches an error, a log line or a response.

On `dev`, the client is the `app` stack's hosted web app client, registered for the
distribution's URL, and its secret is copied into the parameter by the stack's
`Custom::WebClientSecret`; `writing-infrastructure` holds both, and the names the stack
sets.

## Tests never call Cognito

- `tests/cognito-tokens.ts` generates an RS256 key and signs access tokens shaped as the
  pool issues them; the test hands `keySetOf(...)` to the authenticator as `keySet`, so
  the real `aws-jwt-verify` path runs and no JWKS is fetched.
- `tests/web-session-harness.ts` is a fake user pool answering `InitiateAuth`,
  `/oauth2/token` and `/oauth2/revoke` by the pool's rules — the `SECRET_HASH` checked
  against one computed apart from the API's, a wrong password and an unknown user
  refused alike, an account made with `addUser` in any state (confirmed, a temporary
  password's challenge, a demanded reset, unconfirmed), the client secret checked at the
  domain, refresh tokens rotated — and a browser that keeps the cookies the API sets.
  `tests/web-login.test.tsx` routes the rendered sign-in page's `fetch` through it, so
  the page, the API and the fake pool run together; the stand-in's configuration is the
  same suite's `fakeApi` answering every read signed in and `/v1/auth/*` with a 404.
- `tests/api-lambda.test.ts` adds a fake extension on `localhost:2773`.

A test that needs a token signs one this way; it never reads a real pool's id, secret or
domain from the shell.
