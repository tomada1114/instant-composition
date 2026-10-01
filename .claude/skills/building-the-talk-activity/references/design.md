# Talk practice — technical design

How the talk activity in [requirements.md](requirements.md),
[ux-screens.md](ux-screens.md) and [ux-flows.md](ux-flows.md) is built on this
repository's architecture. Where a part has landed, the code and
`mapping-the-architecture` are the record; this file keeps the shape and the reasons,
and changes in the same pull request as anything that moves them.

## The shape

- **A new context, `talk`,** as modules inside the existing packages, beside
  practice-composition: its rules in `packages/domain`, its commands and model tasks in
  `packages/application`, its store entry and model adapters in `packages/adapters`. It
  shares no data with the drill. The streak, the points and the records stay the
  drill's.
- **The server runs the steps.** The step order is fixed (requirements §4): the API
  decides which step comes next and refuses one out of order, and the model answers once
  per step. No model chooses a step, and nothing runs an agent loop.
- **The model answers inside the request.** No queue and no worker: the answer is
  returned in the response of the request that asked for it (requirements §4).
- **One port for every model call,** `LanguageModel`, with one adapter per provider. The
  provider today is OpenRouter, a stopgap while the dev account's Bedrock quotas are
  zero (#276). The target is Bedrock Converse, called directly; replacing OpenRouter
  with it is a change of adapter and configuration, never of a prompt or a command. A
  stand-in that answers from a script serves tests and a local run with no key.
- **The model is Claude Haiku 4.5**, chosen for speed and for how well it reads
  Japanese, and because the same model is served on both providers, so moving to Bedrock
  keeps its behavior. It is configuration: `anthropic/claude-haiku-4.5` on OpenRouter,
  the `jp.anthropic.claude-haiku-4-5-20251001-v1:0` cross-Region profile on Bedrock,
  which keeps processing inside Tokyo and Osaka.

## Operations

All under `/api/v1`, added to `packages/contracts` like every other route. The Japanese
step (W3a) calls nothing: the client sends the Japanese and the English together.

| Operation       | Method and path                                | Request                       | Answer                                                | Model calls                      |
| --------------- | ---------------------------------------------- | ----------------------------- | ----------------------------------------------------- | -------------------------------- |
| `startTalk`     | `POST /v1/talks`                               | `{ talkId }`                  | the scene and the partner's opening line              | scene, 1                         |
| `sendTurn`      | `POST /v1/talks/{talkId}/turns`                | `{ turn, japanese, english }` | the judgment, and the partner's reply when it arrived | teacher and partner, in parallel |
| `retryReply`    | `POST /v1/talks/{talkId}/reply`                | none                          | the partner's reply to the latest turn                | partner, 1, unless already kept  |
| `recordRecital` | `POST /v1/talks/{talkId}/turns/{turn}/recital` | `{ revealCount }`             | `204`                                                 | none                             |
| `endTalk`       | `POST /v1/talks/{talkId}/end`                  | none                          | `{ kept }`: whether the talk is kept as a record      | none                             |

- `turn` is 1 to 6. `japanese` and `english` are 1 to 300 characters; `english` is
  `null` when the learner gave up with 「わからない」, and is refused with
  `ERR_BAD_REQUEST` when it holds a Japanese character — the same rule the field applies
  (ux-flows §4.5), held by the domain so a client cannot skip it.
- The judgment is `{ verdict, modelAnswer, point }`, `verdict` one of `fine` (the ○),
  `corrected` (W3e), or `failed` (the teacher's call failed: the toast, then the
  partner). A give-up is always `corrected`.
- The reply is `{ line, closing }`; `closing` is true on turn 6. When the partner's call
  fails, `sendTurn` still commits the turn and answers `reply: null`; the client shows
  W3g, and 「もう一度」 calls `retryReply`.
- Every write is safe to resend. `startTalk` with a `talkId` that exists answers the
  talk it made; `sendTurn` for a turn already kept answers the kept result without
  calling the model; `retryReply` answers a kept reply; `endTalk` on an ended talk
  answers the same `kept`. Model output is not deterministic, so idempotency is the
  first result, stored.
- A turn other than the next one is `ERR_CONFLICT`; a turn on a finished or ended talk
  is `ERR_TALK_CLOSED` (409); an unknown, expired or another learner's talk is
  `ERR_TALK_NOT_FOUND` (404); a scene or reply that could not be had is
  `ERR_MODEL_UNAVAILABLE` (503), which W2 and W3g answer with 「もう一度」.
- `recordRecital` is fire-and-forget for the client: 「言えた」 shows the held reply at
  once, and a failed recital record is dropped rather than shown.
- `bindRoutes` in `apps/api/src/routes.ts` takes only `{roundId}` today; these routes
  need `{talkId}` and `{turn}`, validated the same way.

## Data

One item per talk in the learner's partition, the turns inside it:

```text
LEARNER#<id>  TALK#<talkId>    a talk, its scene and its turns (at most 6)
```

A talk is the consistency boundary: every command reads it and commits one versioned
update, or one put for `startTalk`. Six turns of at most 300 characters each way, with
the model's output, stay far under DynamoDB's item limit.

```ts
interface Talk {
  id: string;
  status: "open" | "finished" | "ended" | "discarded";
  startedAt: number; // epoch ms
  endedAt?: number;
  expiresAt?: number; // epoch seconds, the table's TTL attribute; absent once kept
  scene: { partner: string; place: string; relation: string; description: string }; // Japanese
  opening: string; // the partner's first line
  turns: Turn[];
  model: { provider: string; modelId: string; prompts: Record<TalkTask, string> }; // versions
}

interface Turn {
  n: number;
  partnerLine: string; // the line this turn answers: the opening or the previous reply
  japanese: string;
  english: string | null; // null when the learner gave up
  judgment: {
    verdict: "fine" | "corrected" | "failed";
    modelAnswer: string;
    point: string;
  };
  reply?: string; // the partner's next line; turn 6's is the closing
  revealCount?: number; // presses of 「もう一度見る」, from recordRecital
}
```

- **What is kept** (requirements §3.5). A talk is created `open` with `expiresAt` one
  day after its start. The commit that keeps turn 6 makes it `finished`; `endTalk` makes
  it `ended` when it holds a turn and `discarded` when it holds none. `finished` and
  `ended` drop `expiresAt` and are kept for good; an `open` or `discarded` talk is
  deleted by DynamoDB's TTL, so a talk closed mid-way is never kept, and nothing resumes
  it.
- TTL deletes late, so the application reads a talk whose `expiresAt` has passed as
  absent; both stores then behave alike. The learner table gains `expiresAt` as its TTL
  attribute, which no other entry sets.
- The store port gains `talk(id)`, an `Entry`/`Key` of type `talk`, and a `Fields` list
  in `packages/adapters/src/declared.ts`; the contract suite's `READS` gains it,
  isolation included. Nothing deletes an entry: the TTL does.
- `model` records the provider, the model and each prompt's version, so a later look at
  the records can tell which prompt produced a turn.

## The model port

```ts
interface LanguageModel {
  generate<T>(
    request: ModelRequest<T>,
    signal: AbortSignal,
  ): Promise<Result<ModelReply<T>, ModelFailure>>;
}

interface ModelRequest<T> {
  task: TalkTask; // "talk-scene" | "talk-teacher" | "talk-partner"
  promptVersion: string;
  system: string;
  messages: readonly { role: "user" | "assistant"; text: string }[];
  output: {
    name: string;
    schema: JsonSchemaObject;
    read: (value: unknown) => T | undefined;
  };
  temperature: number;
  maxOutputTokens: number;
}

interface ModelReply<T> {
  value: T;
  call: {
    provider: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costUsd: number | null;
  };
}

interface ModelFailure {
  code: "ERR_MODEL_UNAVAILABLE";
  reason: "timeout" | "throttled" | "denied" | "malformed" | "transport";
}
```

- **Why one port and not one per task:** three tasks times two providers would be six
  implementations. The tasks — prompt, output schema, version — live in the application
  and are shared by every adapter, so a provider change never touches a prompt, and the
  call record attaches to a task and a version. A bare `complete(prompt)` would lose
  both.
- **Structured output.** Each task states its output as a JSON Schema the adapter sends
  as the provider's structured-output format, and a `read` that narrows the parsed
  value; a value `read` refuses is `malformed`. The application imports no zod
  (AGENTS.md "Architecture"), so the schema is a literal beside a hand-written guard,
  and a test holds them to the same examples. The schema stays inside what Bedrock's
  structured outputs accept — no `minLength`, `maxLength`, `minimum` or `maximum`,
  `additionalProperties: false`, every property required — and length rules are the
  prompt's and the domain's.
- **Timeouts.** Each call is bounded by an `AbortSignal` (`TALK_TUNING.modelTimeoutMs`,
  12 s to start with). `sendTurn` runs its two calls together, so a turn waits for the
  slower one. The function timeout rises from 10 s to 25 s, under API Gateway's 30 s and
  CloudFront's default 30 s origin timeout. `packages/application` compiles with no DOM
  and no Node types, so the port's parameter is `AbortSignalLike`, the members of an
  `AbortSignal` it reads; any `AbortSignal` is one.
- **Telemetry.** Every call writes one log line of its own, beside the request line:
  `kind: "model-call"`, `requestId`, `task`, `promptVersion`, `provider`, `modelId`,
  `outcome`, `inputTokens`, `outputTokens`, `latencyMs`, `costUsd`. Never a prompt, a
  learner's text or the model's output.
- **Learner text is data.** It reaches the model only inside the user messages, each
  part in its own delimiter (`<japanese>…</japanese>`), never in the system prompt; the
  system prompt says to treat what is inside as the learner's words, not instructions.
  The model has no tools and answers into a schema, so an injection can only change its
  author's own talk. No prompt names a learner id.

## Adapters and configuration

| Adapter    | Where it runs                   | What it calls                                                                     |
| ---------- | ------------------------------- | --------------------------------------------------------------------------------- |
| OpenRouter | local with a key; `dev` for now | `POST https://openrouter.ai/api/v1/chat/completions` through the injected `fetch` |
| Stand-in   | local without a key; tests      | nothing: scripted answers per task                                                |
| Bedrock    | `dev`, once #276 clears         | `ConverseCommand` from `@aws-sdk/client-bedrock-runtime`                          |

- **OpenRouter** uses plain `fetch` and the OpenAI-compatible body, so it adds no
  dependency:
  `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`,
  and `provider: { require_parameters: true, data_collection: "deny" }` so a request is
  only routed to an endpoint that honors the schema and keeps no data. `usage.cost`
  fills `costUsd`.
- **Local run.** `pnpm api` and `pnpm dev` start Node with
  `--env-file-if-exists=.env.local`, so the owner's key reaches the process without a
  shell export. The provider is OpenRouter when `API_OPENROUTER_API_KEY` is set and the
  stand-in otherwise; `API_MODEL_ID` overrides the model. Tests and the smoke suite
  never load `.env.local`. Agents still never read it (AGENTS.md "Security and human
  approval"); `.env.example` lists the names with empty values.
- **Hosted.** The `app` stack sets `API_MODEL_PROVIDER`, `API_MODEL_ID` and
  `API_OPENROUTER_KEY_PARAMETER`, the name of a `SecureString` the owner puts by hand at
  `/instant-composition/dev/app/openrouter-api-key`. The function reads it per call
  through the Parameters and Secrets extension, as it reads the web client's secret, and
  its role gains `ssm:GetParameter` on that one parameter.
- **Limits.** AGENTS.md "Rate limiting" puts a provider-billing endpoint's throughput at
  the edge: the talk routes get their own HTTP API route with a stage throttle (2
  requests a second, burst 10, to start with). Spend is capped on the provider's side:
  the Bedrock budget action already denies Bedrock to the function's role; OpenRouter's
  key carries a monthly credit limit the owner sets. The app keeps no usage cap
  (requirements §4).

## Prompts

Each task has a version (`talk-teacher@1`) bumped with any change to its prompt or
schema. The prompts are English; what the learner sees in Japanese is produced in
Japanese.

| Task           | Input                                                                                                                           | Output                                                                                                 | Temperature, max tokens |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------- |
| `talk-scene`   | the scene kind, which the domain draws from a seeded random: about 2/3 talking about yourself, 1/3 an errand or a small trouble | `{ partner, place, relation, description }` in Japanese, `description` 1–2 lines; `opening` in English | 1.0, 300                |
| `talk-teacher` | the scene, the partner's line, the learner's Japanese, their English or nothing on a give-up                                    | `{ verdict, modelAnswer, point }`; `modelAnswer` and `point` empty when `fine`                         | 0.2, 300                |
| `talk-partner` | the scene, the talk so far, this turn's Japanese and English, the turn number of 6                                              | `{ line }`, 1–2 sentences                                                                              | 0.7, 150                |

- **Scene:** everyday conversation only; no specialist or heavy topic (politics,
  religion, medicine), no trouble that forces a long explanation; the partner is a
  friendly local interested in the learner (requirements §3.1, §3.2). The domain picks
  the kind so the 2/3 to 1/3 split holds; the model picks the scene within it.
- **Teacher:** worth correcting when meaning in the Japanese is lost, the English is
  unnatural, or a sentence broke; an error of articles or prepositions alone is not. The
  model answer keeps the meaning and the learner's own wording where it can, at most 2
  sentences of at most 15 words; a long Japanese is held to its core in 2 sentences, and
  the point names what was dropped. The point is one line of Japanese naming the key
  phrase (「詰まってて」→ swamped). It never praises (requirements §3.3).
- **Partner:** requirements §3.2's rules — 1–2 sentences, at most one question, no
  question after its own story, stay 2–3 exchanges on what the learner said, ignore
  input slips, never comment on the learner's English, answer the meaning of the
  Japanese, plain spoken style with no lists, labels or emoji — and on turn 6, close the
  scene in character with no question. The talk so far is sent as alternating messages:
  the partner's lines as `assistant`, each learner turn as `user` with its Japanese and
  English delimited.
- Over-long output is not refused: the length rules are the prompt's to keep, and a
  `read` refuses only a wrong shape. A model answer that runs long is worth seeing in
  use before it is worth a failure. A blank where the step needs text — the partner's
  line, the opening, a scene field, a correction's model answer or point — and `fine` on
  a give-up are wrong answers, not long ones: a `read` refuses them as `malformed`, so
  the scene or reply is asked for again and a teacher's turn is kept as `failed`.

## The web client

- The route is `/talk`, the fourth tab 「会話」 with a speech-bubble glyph; the tab bar
  becomes four equal cells. The screen holds the step it is on in React state: a reload
  loses the talk, as requirements §3.1 asks.
- New parts go into designing-ui's inventory first (ux-flows §4.1): the four tabs, the
  talk line, the waiting line, the hidden model answer, and the underline field rebuilt.
- Requests follow the operations above: 「始める」 → `startTalk`; 「送る」 on the
  English or「わからない」 → `sendTurn`; the held reply shows after 「言えた」 or with
  the ○; W3g's「もう一度」 → `retryReply`; W4's 「終える」 → `endTalk`. Leaving mid-talk
  goes through the drill's `useBlocker` pattern and the leave sheet's recipe.
- While a field has focus, the tab bar hides and the bottom panel sits on the keyboard,
  positioned from `visualViewport`; the conversation scrolls in what is left. Checked on
  a real iPhone.
- The ○ plays the drill's ○ sound under the same setting.

## Moving to Bedrock

Waits on #276, which records the first live call of the chosen model from the `dev`
account. Then, in one change:

- A Bedrock Converse adapter: `outputConfig.textFormat` with the task's JSON Schema,
  usage from the response, cost from a price table in configuration;
  `@aws-sdk/client-bedrock-runtime` added with the review record `managing-dependencies`
  asks for, and to the adapters' boundary rows.
- Bedrock compiles a grammar the first time it sees a schema, which can take minutes,
  and keeps it 24 hours, so a talk started after a quiet day could outrun the timeout.
  Measure it before relying on it; JSON asked for by the prompt and checked by `read` is
  the fallback.
- The function's role gains `bedrock:InvokeModel` on the `jp.` profile and on the model
  in `ap-northeast-1` and `ap-northeast-3`, conditioned on that profile; the budget
  action already covers it.
- `dev` switches to it; the OpenRouter adapter, its environment names, its parameter and
  its grant are removed. The stand-in stays.
