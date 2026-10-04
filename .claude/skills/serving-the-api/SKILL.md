---
name: serving-the-api
description: >
  Covers apps/api, the Hono app serving packages/contracts' ROUTES under /api/v1: an
  operation handler, the route-table check, the order a request is checked in, the error
  envelope and body reader, the request and model-call log lines, the talk model's
  wiring, the Lambda entry lambda.ts and readHostedEnv, apps/api/src/env.ts,
  .env.example and .env.local, and pnpm api or pnpm dev. Use when an endpoint is added
  to the contract, a log field or an API_* variable is added, a request is refused with
  an unexpected code, a talk call fails, or the API or its Lambda function will not
  start.
---

# Serving the API

**Owns:** how `apps/api` turns the contract into HTTP — the handler table, the order a
request is checked in, the log line, the hosted entry's wiring, the environment and the
local run. **Does not own:** the schemas and the `ROUTES` table themselves
(`packages/contracts`); the commands and queries a handler calls
(`designing-application-core`); which authenticator runs, the credentials, the cookies
and the `/v1/auth/*` endpoints (`authenticating-learners`); who may reach whose data
(`isolating-learner-data`); the `ERR_*` vocabulary (`designing-errors`); the web client
that calls it through the `/api` proxy (`building-web-screens`); where a test goes
(`placing-tests`).

## One table, checked both ways

`packages/contracts`' `ROUTES` is the list of operations; `apps/api/src/operations.ts`'s
`OPERATIONS` holds one handler per `operationId`. `createApp` pairs them through
`bindRoutes` and throws `RouteTableError` (`ERR_API_ROUTE_TABLE`) when a route has no
handler, a handler has no route, a handler validates another schema object than the
route's `requestBody`, or the two disagree on a path parameter (`{roundId}`, `{talkId}`,
`{turn}`, `{sessionId}`, `{cardId}`: the handler's `params` must name exactly the ones
its path does). The vocabulary's handlers sit in `apps/api/src/vocab-operations.ts`, the
talk's in `apps/api/src/talk-operations.ts`, each spread into `OPERATIONS`. So an
operation is added in two places: the route in contracts (which regenerates
`openapi.json`), then the handler. `tests/api-routes.test.ts` fails until both exist.

Build a handler with the helpers — `query`, `roundQuery` and `command` in
`apps/api/src/handlers.ts`, `cardAction` in `apps/api/src/vocab-operations.ts`, and
`talkCommand` and `talkAction` in `apps/api/src/talk-operations.ts` — rather than by
hand: each takes the contracts schema itself, which is what the identity check compares.
A talk handler answers a refusal with its code alone, so a `ModelFailure`'s `reason`
never reaches the response or the request line. The success status comes from the route,
never from the handler; a `204` route answers an empty body.

## The order a request is checked in

Authenticate (no credential that verifies is `ERR_UNAUTHENTICATED`, a session cookie on
a state-changing request from a foreign origin `ERR_FORBIDDEN`), sign the subject in
with `signIn` over the learner directory (a first sign-in registers the learner; a
registration that keeps losing its race is `ERR_CONFLICT`), and build the
`RequestContext` from the stored profile (a refused context is `ERR_FORBIDDEN`), then
validate each path parameter with its contracts schema (`readPath` in
`apps/api/src/routes.ts`; a `{turn}` must be a plain decimal before the schema's 1 to 6
applies), then read the body through the bounded reader in `apps/api/src/http.ts`
(`ERR_PAYLOAD_TOO_LARGE` past `MAX_REQUEST_BODY_BYTES`, `ERR_BAD_REQUEST` for anything
not JSON or not the schema), then run the command or query. Every refusal is contracts'
envelope, `{ error: { code, message } }`, with `STATUS_BY_CODE`'s status and
`MESSAGE_BY_CODE`'s fixed sentence; nothing the request carried is echoed. A batch's
answers carry no `roundId`: the handler adds the path's.

A request no route matches answers a bare `404`, and a handler that throws a bare `500`.
Neither is a contract code, so a client never branches on them.

Keep every refusal ahead of the work it guards: a request refused after the command ran
has already been paid for. That is why the body is read through the bounded reader
rather than `request.json()` — `Content-Length` is absent under chunked encoding and is
otherwise whatever the client says — and why every string and list in a request schema
carries its own bound (`idSchema`, the `.max` on each array in contracts'
`requests.ts`). The API ships no rate or concurrency limit; AGENTS.md's "Rate limiting"
says where that belongs.

## The log line

`createApp` writes one line per request, matched or not, to the `log` sink it is handed;
`pnpm api` writes each as one line of JSON on stdout. The fields are the operational
baseline plus what an operator needs to act on it, and every one is present on every
line (`null` where it does not apply):

| Field        | Value                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| `requestId`  | Made by the server per request; never read from a header                        |
| `operation`  | The contract `operationId` (`getHome`, …), a web-session endpoint, or `null`    |
| `outcome`    | `ok`, the `ERR_*` code answered, `unmatched`, or `failed`                       |
| `status`     | The HTTP status sent, which the 5xx alarm reads                                 |
| `durationMs` | From the request's arrival to its answer, on the injected clock                 |
| `learnerId`  | The internal `LearnerId` the request acted as, once authenticated               |
| `fault`      | The thrown error's class name when `outcome` is `failed`, else `null`           |
| `reason`     | `missing`, `unreadable` or `malformed` on `ERR_CONTENT_UNREADABLE`, else `null` |

Never add a field carrying a request body, a path, a query string, a card's text, a
learner's answers, a header, a cookie, a token, an authorization code or an error
message: a message can quote what the caller or a dependency sent.
`tests/api-log.test.ts` holds the shape and that absence.

Each model call a talk operation makes writes one more line to the same sink, beside its
request's, from `loggedModel` in `apps/api/src/model-log.ts`, which wraps the configured
model per request (the commands log nothing):

| Field                          | Value                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `kind`                         | Always `model-call`; a request line has no `kind`                                                 |
| `requestId`                    | The request's, which joins the line to its request line                                           |
| `task`, `promptVersion`        | `talk-scene`, `talk-teacher` or `talk-partner`, and its version (`…@1`)                           |
| `provider`, `modelId`          | Who served the call, or who was configured to when it produced no answer                          |
| `outcome`                      | `ok`, the `ModelFailure` reason (`timeout`, `throttled`, …), or `failed`                          |
| `attempt`, `duplicatePossible` | Durable attempt number; whether a previous attempt may have reached the provider without a result |
| `providerOutcome`              | `unknown` for timeout, transport or a thrown adapter error, `known` otherwise                     |
| `inputTokens`, `outputTokens`  | The provider's counts; `null` when the call produced no answer                                    |
| `latencyMs`                    | The provider adapter's measure on an answer, the edge's clock otherwise                           |
| `costUsd`                      | The provider's reported cost; `null` when it reported none or none answered                       |

A model-call line never carries a prompt, a learner's text or the model's output; the
task and its version name what was asked. `failed` means the adapter threw — a key that
could not be read — and the request then ends as the bare 500 its own line names by
class. `tests/api-talk.test.ts` holds the fields and that no talk text reaches either
line.

## The talk model

`ApiDependencies.model` is a `ServedModel` — the `LanguageModel` with the provider and
model id it is configured as — built in `apps/api/src/served-model.ts`. A local run gets
OpenRouter when `API_OPENROUTER_API_KEY` is set, at `API_MODEL_ID` or
`anthropic/claude-haiku-4.5`, and otherwise `standInTalkModel()`, a scripted stand-in
with an answer for every talk task, so a keyless run drives a whole talk; the start-up
line names which. Every test and the smoke suite run the stand-in. Each call is bounded
by `TALK_TUNING.modelTimeoutMs` and by the caller hanging up
(`AbortSignal.any([request.signal, AbortSignal.timeout(ms)])`, the `deadline`
`answer.ts` hands the commands). A scene or a retried reply that could not be had is
`ERR_MODEL_UNAVAILABLE` (503); a turn whose calls failed is still kept. The design
behind the port and the prompts is `building-the-talk-activity`'s.

## Authentication

Authentication is the first step of every request and the only one this skill does not
hold. `createApp` is handed an `authenticator` and, when a user pool is configured, a
`webSession` whose `/v1/auth/*` endpoints it mounts outside `ROUTES`; `main.ts` picks
Cognito's or the stand-in through `localRunAuthenticator`, and the hosted entry always
builds Cognito's. **REQUIRED:** `authenticating-learners` for which authenticator runs
where, the credential paths and cookies, the sign-in endpoints and the `API_COGNITO_*`
names, and `isolating-learner-data` before touching either authenticator.

## The hosted entry

`apps/api/src/lambda.ts` is the Lambda handler behind API Gateway's HTTP API, the one
module besides `main.ts` that wires AWS: the DynamoDB stores and directory in the
function's Region (`regionalDynamoDbClient`), the catalog snapshot bundled with the
function, and `hostedHandler` from `apps/api/src/hosted.ts`, which runs the app through
`hono/aws-lambda`'s `handle` and puts every `Set-Cookie` in the result's `cookies`.
`hostedApp` builds Cognito's authenticator, the web sign-in endpoints and the model
itself from `HostedEnv`, and `HostedDependencies` has no field for any of them, so
neither stand-in can be wired there at all. The model is the provider
`API_MODEL_PROVIDER` names (`openrouter`, the only one today) at `API_MODEL_ID`, its key
read through the Parameters and Secrets extension from `API_OPENROUTER_KEY_PARAMETER` on
every call, as the web client's secret is, so the function starts whether or not the
parameter exists; a talk call that cannot read it is the bare 500 above, and every other
route is unaffected. `API_OPENROUTER_API_KEY` is refused there, as
`API_COGNITO_CLIENT_SECRET` is.

`readHostedEnv` validates the hosted environment once, when `lambda.ts` is first loaded,
and throws — failing the function's start — unless every `HOSTED_ENV_NAMES` entry but
the extension's port and the two refused secrets is set, the three model names included.
How the web app client's secret reaches the function, and why
`API_COGNITO_CLIENT_SECRET` is refused there, is `authenticating-learners`'. The hosted
names are the `app` stack's to set (`addApiFunction` in `infra/src/api-function.ts`),
never a shell's, so `.env.example` does not list them: Lambda supplies the Region and
the session token, the stack everything else, with the web origin and both redirect URLs
derived from the distribution's URL. A hosted name added here is added there in the same
change, or the next deploy's function fails to start. `tests/api-lambda.test.ts` drives
`hostedHandler` with HTTP API events, and `tests/api-local-run.test.ts` loads
`lambda.ts` itself with and without its configuration.

In `dev`, CloudFront sends `/api/*` to the HTTP API with the path unchanged, so the app
serves the same `/api/v1/...` paths as locally, and each line of the log goes from
stdout to the function's log group. The function runs an esbuild bundle of `lambda.ts`
with every import inlined and the catalog snapshot built beside it at
`API_CATALOG_PATH`. `tests/infra-api-bundle.test.ts` builds that bundle and starts it in
a bare Node process, so it is the check to run after changing what `lambda.ts` imports.
**REQUIRED:** `writing-infrastructure` for the function, the route and the distribution.

## Environment and the local run

`apps/api/src/env.ts` is the only module in `apps/api` that reads `process.env`, and
`API_ENV_NAMES` lists what the local run reads (`HOSTED_ENV_NAMES` the hosted entry's);
every local name has a default or is optional, so none has to be set. The rule each
value is held to lives in `apps/api/src/env-values.ts`, shared by both readers, and the
model's names in `apps/api/src/env-model.ts`. The names come from the shell, or from a
gitignored `.env.local` at the repository root: `pnpm api`, and `pnpm dev`'s API child
alone, start Node with `--env-file-if-exists=.env.local`, so Node reads the file itself
and a name the shell sets wins. Nothing else loads it — not the web client, not a test,
not the smoke suite, which starts the API without the flag and with the model key
cleared, so no test reaches OpenRouter. That is how the owner's model key reaches a
local run; an agent still never reads, writes or prints a `.env*` file (AGENTS.md
"Security and human approval"). Because only the API loads the file, two names are shell
only and never belong in `.env.local`: `API_PORT`, which the web client's Vite proxy
reads from the shell alone, and `API_CATALOG_PATH`, which `pnpm dev`'s catalog check
reads from the shell alone — set only in the file, either moves the API while the proxy
or the check still uses the default. Adding a name means adding it to
`apps/api/src/env.ts` _and_ to `.env.example` with an empty value;
`tests/env-example.test.ts` fails until the two agree, and is the check to run first. A
blank value reads as absent, and a value no setting accepts stops the process at start
(`ERR_API_ENV_INVALID`, naming every such variable) rather than returning a `Result`: a
malformed environment is a deployment mistake no caller can recover from. Never open a
real `.env` to learn what exists; AGENTS.md holds that prohibition. `pnpm api` runs
`apps/api/src/main.ts` on Node's own type stripping, through `scripts/ts-hooks.mjs`,
whose resolve hook retries an extensionless relative import as `.ts` — no build, no
loader dependency. Code that Node cannot strip (an `enum`, a parameter property) fails
`tests/api-local-run.test.ts`, which loads the whole module graph the same way.

```sh
pnpm db:up && pnpm catalog:build && pnpm api   # http://127.0.0.1:8787/api/v1/home
pnpm dev                                       # the same, plus the web client in front of it
```

`pnpm dev` (`scripts/dev.mjs`) brings DynamoDB local up, builds the catalog snapshot
only when the default one is missing, and runs the API as `pnpm api` does beside the web
client's Vite dev server, which proxies `/api` to `API_PORT`; Ctrl-C stops both, and
`pnpm db:down` stops DynamoDB local. The learner table is created on first start. The
catalog is read from `dist/catalog/en/ja.json`; the start-up line says whether it was
readable, and the next request that needs it reads it again.

## Checks

`pnpm exec vitest run tests/api-*.test.ts` drives the app with `new Request(…)` over the
in-memory store; `pnpm test:dynamodb` runs `tests/api-dynamodb-local.test.ts` against
DynamoDB local. Neither starts a server: `main.ts` is the one file only a real run
exercises, which is why it only wires what is tested elsewhere. `pnpm test:smoke` is the
one suite that starts it, as `pnpm api` does less `.env.local`, behind the built web
client's `/api` proxy.
