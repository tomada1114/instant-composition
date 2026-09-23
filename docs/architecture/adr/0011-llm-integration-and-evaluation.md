# ADR-0011: LLM integration and evaluation

- Status: Proposed
- Date: 2026-09-23
- Deciders: the owner

## Context

The application calls no language model at runtime today. Cards are written ahead of
time by agent skills through `pnpm cards:*`, and each is shown only after a human review
stamps it (AGENTS.md, "Content"). The learner grades their own answer as `ok`, `ng` or
`timeout` (`src/core/types.ts:4-5`).

The owner's sequence puts LLM features after the infrastructure and authorization work,
and after a period of using the app without them. When they arrive, the first feature is
grading and feedback on **typed** answers. Voice comes later. This ADR fixes the shape
of that integration now, so the earlier phases leave the right seams. It builds nothing
yet.

The guiding principles make evaluation the center of the design:

- Quality is stated as numbers.
- A change that lowers quality is stopped in CI.
- Every call's tokens, latency and cost can be traced.
- Model output arrives as validated JSON, never as free text to parse.

The content is multi-language by design
([ADR-0004](0004-multi-language-content-model.md)). The owner can review only some
language pairs. Pairs the owner cannot read rely on LLM review alone.

## Decision drivers

- The timed drill must never wait on a model. The card timer is 6–20 seconds
  (`src/core/tuning.ts:12`).
- Every model call is attributable: to a feature, a learner (through the entitlements
  ledger, [ADR-0010](0010-entitlements-and-billing.md)), a prompt version and a model.
- Tests and evaluation can run a task against a fake, a recording or the real model with
  the same code.
- Running the same job twice must not call the model twice or charge twice.
- Each language pair is evaluated on its own, because rubrics and feedback language
  differ per pair.

## Considered options

1. **Task-level ports with one Bedrock Converse adapter underneath.**
2. One generic `complete(prompt)` port. It is easy to add, but every caller has to own
   its prompt, schema and parsing. Evaluation then has no unit to attach to, and cost
   attribution depends on each caller remembering to tag.
3. An agent framework for every LLM use. Grading, feedback and card generation are
   fixed-step workflows with typed input and output. An agent loop adds cost and
   variance without adding a capability ([ADR-0012](0012-agents-and-agentcore.md)).

## Decision

Adopt option 1.

**Ports.** Each LLM task is a port typed in the application layer
([ADR-0002](0002-architecture-style-and-repository-layout.md)):

```ts
type GradeComposition = (
  context: RequestContext,
  input: {
    pair: { l1: string; target: string };
    prompt: string; // in the learner's L1
    reference: { text: string; alternatives: readonly string[] };
    answer: string; // typed by the learner, length-capped
    rubricVersion: string;
  },
) => Promise<Result<Graded, LlmError>>;

interface Graded {
  grade: {
    verdict: "correct" | "acceptable" | "incorrect";
    errorTags: readonly string[]; // concept ids, e.g. "en:grammar/present-perfect"
    feedback: string; // in the learner's L1
  };
  call: {
    modelId: string;
    promptVersion: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    latencyMs: number; // measured by the client around the call
    estimatedCostUsd: number;
  };
}
```

Each task owns four things: its prompt, its output schema, its rubric version and its
evaluation set.

**Adapter.** One Bedrock Converse adapter serves every task.

- **Structured output.** It requests output through `outputConfig.textFormat` with
  `type: "json_schema"`. The schema is generated from the task's zod schema, and the
  response is validated again before use.
- **Telemetry.** It fills `call` from the response's `usage` (input, output, cache read
  and cache write tokens) and from its own timer.
- **Cost attribution.** Each feature calls through its own application inference
  profile, tagged for cost allocation. Cost Explorer then splits Bedrock spend by
  feature.
- **Models.**
  - `jp.anthropic.claude-haiku-4-5-20251001-v1:0` for grading. The JP geo profile keeps
    processing within Tokyo and Osaka.
  - A Sonnet-class model through its `jp.` profile, where one exists, for heavier
    offline work such as card generation.

**Synchronous versus asynchronous.**

- The drill records the answer and moves on. Grading is a job keyed
  `grade:<answerId>:<rubricVersion>`.
- The job's first successful result is stored under that key. Later runs return the
  stored result instead of calling the model again. Idempotency comes from storage,
  because model output is not deterministic.
- Locally the job runs inline. In production it runs on an SQS-triggered worker Lambda
  ([ADR-0009](0009-aws-topology-environments-and-operations.md)).
- Results appear on the round summary and the recap, not during the drill.
- Every job reserves its cost in the entitlements ledger before it calls the model,
  under the same key.

**Evaluation.** An evaluation harness lives in the repository, one suite per task and
language pair.

- **Datasets.**
  - Positives from the existing content: 2,052 alternative answers across 1,020 reviewed
    cards.
  - Negatives made by perturbing references in ways that correspond to known error tags.
  - Typed answers that learners graded themselves, once typed input exists.
  - An adversarial set: instructions injected into the answer field, off-task text, and
    the wrong language.
- **Metrics.**
  - Agreement with gold labels.
  - Flip rate: how often the verdict changes when the same input is graded N times.
  - Precision, recall and F1 for error tags.
  - Cost and latency per graded answer.
- **CI gate.**
  - A pull request that changes a prompt, an output schema or model configuration runs a
    small subset against the real model, under a spend cap. It fails when a metric falls
    below its recorded baseline.
  - Full runs are manual or nightly.
  - Everything else tests against fakes and recordings.
  - The gate is a CI change, so it goes through `changing-gates` and the owner's
    approval.
- **Bedrock's evaluation feature** (LLM-as-a-judge, custom metrics, bring-your-own
  responses) supplements the harness. It is not the gate, because the gate's thresholds
  must live in this repository.

**Defenses.**

- The grader has no tools, and its output is schema-bound. A successful injection can
  only corrupt the attacker's own grade on their own answer, because every call is
  scoped to the calling learner.
- The real risk is cost abuse. It is met by input length caps and the entitlements
  ledger.
- `ApplyGuardrail` with the `PROMPT_ATTACK` content filter can screen input as an
  additional layer, independent of the model call.

**Card generation later.** Card generation moves from agent skills to a Step Functions
pipeline.

- Bedrock's optimized integration handles single calls. Batch inference, at 50% of
  on-demand price, handles bulk generation.
- The automated reviewer is first measured against the owner's own ja→en decisions:
  1,020 stamped cards and 324 tombstones that record why each card was deleted.
- Only after that is the reviewer trusted, alone, for pairs the owner cannot read.

## Consequences

### Positive

- Every model call has an owner, a schema, a version, a cost and an evaluation. The
  question "did this change make grading worse?" has a numeric answer before merge.
- Duplicate or replayed jobs cost nothing extra.
- Swapping a model is a configuration change, gated by the same evaluation.

### Negative

- Evaluation data needs care. Gold labels for grading must be produced, first by the
  owner for ja→en.
- CI runs that call Bedrock cost money and need AWS credentials in CI, through the OIDC
  deploy role's account.
- For pairs the owner cannot read, feedback quality in that L1 rests on LLM judgment and
  learner reports. This limit is accepted by the owner.
- Typed input needs its own timing rules. Typing an answer within a 6–20 second speaking
  limit is a different task.

### Follow-ups

- Decide how typed input is timed before building it.
- Start collecting self-graded typed answers early, if typed input ships before grading.
  This gives the evaluation set real data.
- Measure Converse latency and cost for Haiku 4.5 on the JP profile with a spike before
  committing to per-answer versus per-round grading.

## Open questions

- Per-answer or per-round grading calls. A per-round call shares the prompt, and caching
  may lower cost, but one failure then affects every answer in the round.
- Unverified: which Claude models newer than Sonnet 4.5 have a `jp.` inference profile.
  Sonnet 4.6 is confirmed only with a `global.` profile.
- Unverified: whether Converse returns `metrics.latencyMs`. Until confirmed, latency is
  measured by the adapter.
- Unverified: whether Bedrock Guardrails is available in Tokyo, and its current price
  per text unit. The only price found is a 2024 us-east-1 figure.
- Unverified: Bedrock's current on-demand prices on the official pricing page. The
  figures here come from an AWS blog.
- Unverified: Amazon Transcribe streaming availability and price in Tokyo (voice input,
  later).

## Sources

All checked 2026-09-23.

- Structured outputs on Bedrock (GA, all commercial regions, `outputConfig.textFormat`):
  https://aws.amazon.com/blogs/machine-learning/structured-outputs-on-amazon-bedrock-schema-compliant-ai-responses/
- JP cross-region inference for Claude Sonnet 4.5 and Haiku 4.5:
  https://aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-cross-region-inference-for-claude-sonnet-4-5-and-haiku-4-5-in-japan-and-australia/
- Model cards (profiles required for on-demand invocation):
  https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html,
  https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-5.html
- Prices (Haiku 4.5 $1 input / $5 output per 1M tokens; Sonnet 4.5 $3 / $15):
  https://aws.amazon.com/blogs/aws-cloud-financial-management/optimize-llm-costs-on-amazon-bedrock-from-billing-attribution-to-operational-telemetry/
- Batch inference at 50% of on-demand: https://aws.amazon.com/bedrock/pricing/
- Token usage fields:
  https://docs.aws.amazon.com/sdk-for-kotlin/api/latest/bedrockruntime/aws.sdk.kotlin.services.bedrockruntime.model/-token-usage/index.html
- Invocation logging:
  https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html
- Application inference profiles and cost allocation:
  https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-create.html,
  https://docs.aws.amazon.com/bedrock/latest/userguide/cost-mgmt-application-inference-profiles.html
- ApplyGuardrail as a standalone API:
  https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-independent-api.html
- LLM-as-a-judge and custom metrics:
  https://docs.aws.amazon.com/bedrock/latest/userguide/evaluation-judge.html,
  https://docs.aws.amazon.com/bedrock/latest/userguide/model-evaluation-custom-metrics-create-job.html
- Step Functions and Bedrock:
  https://docs.aws.amazon.com/step-functions/latest/dg/connect-bedrock.html

## Related

- [ADR-0004](0004-multi-language-content-model.md): language pairs, concept ids, review
  policy
- [ADR-0010](0010-entitlements-and-billing.md): the ledger every job reserves against
- [ADR-0012](0012-agents-and-agentcore.md): when a task becomes an agent
- [References](../references.md)
