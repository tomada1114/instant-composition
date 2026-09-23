# ADR-0012: Agents and Amazon Bedrock AgentCore

- Status: Proposed
- Date: 2026-09-23
- Deciders: the owner

## Context

The project first imagined an "English conversation agent" as its centerpiece. The owner
no longer insists on it: the instant-composition drill and vocabulary practice come
first, and LLM features come after the app has been used without them
([ADR-0011](0011-llm-integration-and-evaluation.md)).

The question is still worth settling now, for two reasons:

- AgentCore is a managed platform that would take over hosting, identity, memory, tool
  access, policy and evaluation for agents. Adopting it where it does not fit would be
  costly to undo.
- Agents are the case where "who may do what on whose behalf" is hardest. Deciding the
  identity rule before any agent exists keeps the seams in the application layer honest.

**Workflow versus agent.**

- A workflow has fixed steps and typed input and output: grading an answer, writing
  feedback, generating and reviewing cards.
- An agent decides at run time which tools to call, over several turns.

Everything planned so far is a workflow.

## Decision drivers

- Pay for agent machinery only where a feature needs open-ended tool use.
- A learner's data is reachable by an agent only on behalf of that learner, enforced
  outside the model.
- The learner's record of progress and weaknesses must stay queryable, testable,
  deletable and exportable with the rest of their data
  ([ADR-0006](0006-persistence-on-dynamodb.md)).
- Tokyo availability, no VPC or NAT requirement, and no minimum fee
  ([ADR-0009](0009-aws-topology-environments-and-operations.md)).
- TypeScript for agent code, matching the rest of the server.

## Considered options

1. **Workflows as plain Bedrock calls now. Adopt AgentCore per feature, only when a
   feature is genuinely agentic.**
2. AgentCore as the core of the product: every feature becomes a tool of a central
   agent. Rejected. The core interaction is a timed drill, not a conversation. An agent
   in that path adds latency, cost and variance, and it cannot be used during the
   owner's planned LLM-free period.
3. Self-host agents on Lambda with a framework and no AgentCore. This is possible, but
   it re-implements session isolation, inbound JWT validation, tool policy and online
   evaluation that AgentCore provides and bills by use.

## Decision

Adopt option 1.

**Now.**

- Grading, feedback and card generation stay workflows behind the task-level ports of
  ADR-0011.
- Nothing is built on AgentCore until a feature meets the adoption condition below.

**Adoption condition.** A feature uses AgentCore when it needs multi-turn, open-ended
tool selection over the learner's data. A conversational tutor that reads the learner's
weaknesses and schedules practice is the canonical example.

**Shape once adopted.** An `agents` CDK stack
([ADR-0009](0009-aws-topology-environments-and-operations.md)).

```text
client ──(Cognito access token)──► AgentCore Runtime (CUSTOM_JWT inbound authorizer)
                                        │ agent code (TypeScript)
                                        ▼
                                   AgentCore Gateway ──(Policy: Cedar)──► Lambda target
                                                                            │ application layer,
                                                                            │ Actor = agent on behalf
                                                                            ▼ of the verified learner
                                                                          DynamoDB
```

- **Runtime.**
  - Hosts the agent, with a dedicated microVM per session.
  - Validates the Cognito access token with a `CUSTOM_JWT` inbound authorizer,
    configured with:
    - the user pool's discovery URL (`.../.well-known/openid-configuration`)
    - the allowed client ids, audiences and scopes
  - Runs in `PUBLIC` network mode, so no VPC is involved.
- **Gateway.**
  - Exposes a curated set of application commands and queries as MCP tools, through a
    Lambda target.
  - That Lambda runs the same application layer as the API, with
    `Actor = { kind: "agent", onBehalfOf: LearnerId, grants }`
    ([ADR-0005](0005-identity-and-authorization.md)).
  - Policy, written in Cedar, restricts which tools each agent may call.
- **Identity rule.**
  - No tool takes a learner id as an argument.
  - The learner comes from the verified session, never from anything the model can
    write.
  - The tools' input schemas are checked in tests so that no learner identifier appears
    in them.
- **Reading claims without re-verifying.**
  - With `Authorization` added to the runtime's request header allowlist, the agent code
    receives the header.
  - The official sample then reads its claims without verifying the signature. That is
    acceptable only inside Runtime, whose authorizer already verified the token.
  - Code outside a verifying authorizer must never copy the pattern.
- **Memory.**
  - AgentCore Memory holds conversational context only: session events and summaries.
  - The learner model (weaknesses by concept,
    [ADR-0003](0003-bounded-contexts-and-activity-integration.md)) stays in DynamoDB as
    the system of record. Four reasons:
    - The deck composer reads it deterministically.
    - Tests pin it.
    - It is deleted and exported with the learner's partition.
    - It must work with no agent involved at all.
  - An agent reads the learner model through a query tool. It changes state only through
    commands its grants allow.
- **Evaluation.**
  - AgentCore Evaluations (online and on-demand) scores agent sessions in production.
  - The repository's harness (ADR-0011) remains the pre-merge gate.
- **Language.**
  - Agent code is TypeScript on the Strands Agents TypeScript SDK and AgentCore's
    TypeScript SDK.
  - Locally it runs with `agentcore dev`, and it is deployed with `agentcore deploy`
    (CDK).

**Facts behind the choice** (AWS documentation and pricing, checked 2026-09-23):

- Availability: Runtime, Memory, Gateway, Identity, Observability, Policy and
  Evaluations are available in Tokyo.
- Runtime billing:
  - Per second, with a one-second minimum. CPU is not charged while the agent waits on
    I/O; memory is.
  - v2 prices are $0.1276 per vCPU-hour and $0.0169 per GB-hour.
  - There is no minimum fee.
- Runtime limits:
  - A microVM session lives up to 8 hours (`maxLifetime`), with a 15-minute idle timeout
    by default.
  - arm64 only.
  - The HTTP contract is `/ping` and `/invocations` on port 8080.
- Gateway: $0.005 per 1,000 tool invocations.
- Identity: no extra charge when used through Runtime or Gateway.
- Memory:
  - $0.25 per 1,000 new short-term events.
  - $0.75 per 1,000 long-term records per month with built-in strategies.
  - $0.50 per 1,000 long-term retrievals.
- Policy became generally available in March 2026. Evaluations became generally
  available on 2026-03-31, with 13 built-in evaluators and custom ones.

## Consequences

### Positive

- No agent infrastructure cost or complexity until a feature needs it.
- When an agent arrives, it reuses the application layer and its authorization. Adding
  an agent adds no second route to the data.
- The learner's record stays independent of any agent platform.

### Negative

- The first agentic feature carries the whole AgentCore setup: Runtime, Gateway, Policy,
  Memory and Evaluations.
- Tool curation is ongoing work. Each tool exposed is a command whose grants and Cedar
  policy must be reviewed like a public endpoint.

### Follow-ups

- When a candidate agentic feature is chosen, write a spike ADR. It covers the tools,
  the grants, how Policy is applied, the Memory namespaces, and the evaluation plan
  before any code.

## Open questions

- Unverified: how Gateway conveys the calling learner's verified identity to a Lambda
  target, when the outbound side authenticates with IAM. The identity rule above depends
  on the answer, so the spike must confirm it first.
- Unverified: the npm package name of AgentCore's TypeScript SDK (`BedrockAgentCoreApp`
  is documented; the package name was not confirmed).
- Whether a conversational feature is worth its cost at all, given the drill-first
  product. Still the owner's decision.

## Sources

All checked 2026-09-23.

- Regions:
  https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html
- General availability:
  https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-is-now-generally-available/
- Pricing: https://aws.amazon.com/bedrock/agentcore/pricing/
- Inbound JWT authorizer:
  https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/inbound-jwt-authorizer.html
- Header allowlist and reading claims:
  https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html
- Session isolation:
  https://aws.amazon.com/blogs/machine-learning/introducing-stateful-mcp-client-capabilities-on-amazon-bedrock-agentcore-runtime/
- Lifecycle settings:
  https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html
- Network mode and Memory namespaces:
  https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html
- TypeScript quick start, arm64, `agentcore dev` and `deploy`:
  https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html
- Node.js HTTP contract:
  https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html
- TypeScript SDK reference:
  https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-typescript-sdk-reference.html
- Memory:
  https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/
- Gateway:
  https://aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-agentcore-gateway-transforming-enterprise-ai-agent-tool-development/
- Identity:
  https://aws.amazon.com/blogs/machine-learning/secure-ai-agents-with-amazon-bedrock-agentcore-identity-on-amazon-ecs/
- Policy:
  https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/
- Evaluations:
  https://aws.amazon.com/about-aws/whats-new/2026/03/agentcore-evaluations-generally-available/
- Strands Agents TypeScript SDK 1.0:
  https://strandsagents.com/blog/strands-agents-typescript-v1/index.md

## Related

- [ADR-0003](0003-bounded-contexts-and-activity-integration.md): the learner-model
  context
- [ADR-0005](0005-identity-and-authorization.md): actors, grants and the authorization
  policy
- [ADR-0011](0011-llm-integration-and-evaluation.md): the workflows that stay plain
  calls
- [References](../references.md)
