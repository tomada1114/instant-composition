# ADR-0010: Entitlements and billing

- Status: Proposed
- Date: 2026-09-23
- Deciders: the owner

## Context

The service will be public with self sign-up
([ADR-0005](0005-identity-and-authorization.md)). Once LLM features ship
([ADR-0011](0011-llm-integration-and-evaluation.md)), every graded answer costs the
operator money. The owner expects to charge for that, probably through Stripe, and would
prefer an option that fits AWS well if one exists. Native apps
([ADR-0007](0007-http-api-contract-and-offline-sync.md)) will also sell through the App
Store and Google Play. Whether learners get a monthly allowance with a subscription or
buy prepaid credits is **undecided**, and this ADR must not force that decision.

Two rules in this repository touch the problem.

- **`requiresAccessKey`.** `src/server/env.ts:75-91` makes the wiring declare whether an
  endpoint bills a provider. If it does, the server refuses to start without
  `API_ACCESS_KEY`. The principle is sound: a billed endpoint must not be open, and the
  wiring, not the environment, decides which endpoints are billed. The mechanism is not
  sound for a public service. One shared key cannot tell one learner from another.
- **AGENTS.md's "Rate limiting" section.** It states that the application "owns no
  limiter state, store, algorithm, or rate-limit environment variable". Throughput
  policy belongs at the edge. A per-learner LLM allowance, read literally, is limiter
  state.

## Decision drivers

- A learner can never spend more than their entitlement, even under retries, parallel
  requests or an offline replay.
- The policy (allowance or credits) can be chosen later without changing the enforcement
  code.
- Several payment sources feed the same entitlement: the web through Stripe, iOS and
  Android through their stores.
- Every provider callback is safe to receive twice.
- Cost figures are accurate to the call. They come from the per-call telemetry of
  ADR-0011, not from a monthly bill.

## Considered options

1. **An entitlements ledger inside the application.** A cost is reserved before each
   billed call and settled after it, keyed by the job key. Payment providers only top
   the ledger up.
2. Rely on the edge. WAF rate rules and API Gateway throttling limit requests per
   client. They cannot express "this learner has paid for N more gradings". They also
   count requests, not money.
3. Delegate entitlements to the payment provider, for example by checking a Stripe
   subscription on every request. This adds the provider's latency and availability to
   every graded answer, and has no answer for store purchases.
4. Unverified candidate: a subscription aggregator that unifies store and web purchases
   (a RevenueCat-style service). Not evaluated. It could later feed the ledger in option
   1, but it does not replace it.

## Decision

Adopt option 1, as the `entitlements` context
([ADR-0003](0003-bounded-contexts-and-activity-integration.md)).

**Ledger.** Each learner has one ledger item in DynamoDB
([ADR-0006](0006-persistence-on-dynamodb.md)).

```text
reserve(learner, jobKey, maxCost)  conditional update: balance ≥ maxCost → balance -= maxCost,
                                   record reservation under jobKey (a second reserve with the
                                   same jobKey is a no-op returning the first result)
call the provider (Bedrock)        the reservation is the permission to call
settle(learner, jobKey, actualCost) balance += maxCost − actualCost; reservation → settled
expire                             a reservation never settled is released after a timeout
```

- The job key is the same key that makes the LLM job idempotent. For example,
  `grade:<answerId>:<rubricVersion>` from ADR-0011. A retried or replayed job is charged
  once.
- `maxCost` is computed from the request's input size and the task's output cap. So a
  reservation can never be exceeded by the call it covers.

**Policy.** Allowance and credits differ only in how the balance is replenished.

- A monthly allowance resets or adds to the balance at each billing period.
- Prepaid credits add to it on each purchase.

Enforcement (reserve and settle) is identical, so the choice can wait.

**Payment sources.**

- Stripe webhooks for the web.
- App Store and Google Play purchase notifications for the native apps, once they exist.
- Each source is an adapter that turns a verified provider event into a ledger credit or
  an entitlement change. It is idempotent by the provider's event id: a conditional
  write stores the id, and a repeat is acknowledged and ignored.
- Webhook endpoints are Web-standard handlers, like every other handler.
- Unverified: the stores' rules on selling digital goods and subscriptions, and what
  they require of an app that also sells on the web. These rules can dictate which
  source a learner may use on which platform. They must be read before pricing is
  designed.

**Wiring rule.** Generalize `requiresAccessKey`:

- An endpoint or job that bills a provider must require an authenticated learner and a
  ledger reservation.
- The wiring declares this, and startup fails if a billed task is wired without a
  ledger.
- The shared `API_ACCESS_KEY` retires once Cognito authentication exists.

**AGENTS.md amendment (needs the owner's approval before it is made).**

- Reword the "Rate limiting" section to separate two concerns.
  - Caller throughput: requests per client per time window. It stays at the edge, and
    the application still owns no limiter.
  - Entitlement: how much billed work a learner has paid for. It is business state held
    in the ledger.
- Until that amendment lands, no ledger code is merged. That keeps the written rule and
  the code from contradicting each other.

**Account-level backstop.** A budget action that denies Bedrock access
([ADR-0009](0009-aws-topology-environments-and-operations.md)) protects the account if
the ledger has a bug. It is not the per-learner guard: it watches the whole account, not
one learner. Unverified: budget data lags actual spend, which would also keep it from
stopping a single learner in time.

## Consequences

### Positive

- Monetization is a policy choice layered on a mechanism that exists before any price
  does.
- Retries, offline replays and duplicate webhooks cannot double-charge or double-credit.
- The ledger is the per-learner cost record the owner needs anyway, to say what one
  round of grading costs.

### Negative

- The ledger is money-like state. It needs its own tests: concurrent reserves against a
  small balance, expiry of abandoned reservations, and replay of every provider event.
- Store purchases bring platform rules this repository does not control.
- One more item is written on every billed call.

### Follow-ups

- Draft the AGENTS.md "Rate limiting" amendment as its own pull request, for the owner's
  decision.
- Decide the policy (allowance or credits) and the first price before LLM grading is
  public.
- Read the App Store and Google Play rules before the native apps plan their paywall.

## Open questions

- Allowance or prepaid credits, or both. Still the owner's decision.
- Unverified: whether an AWS-native payment option fits better than Stripe. None was
  evaluated.
- Unverified: App Store and Google Play rules for digital goods, subscriptions and
  pointing to web purchases.
- How long a reservation may stay open before it is released, and what the learner sees
  when a job fails after the reservation.

## Sources

- AWS Budgets pricing and actions, checked 2026-09-23:
  https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/,
  https://aws.amazon.com/blogs/aws-cloud-financial-management/get-started-with-aws-budgets-actions/
- DynamoDB condition expressions, checked 2026-09-23:
  https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html

## Related

- [ADR-0003](0003-bounded-contexts-and-activity-integration.md): the `entitlements`
  context
- [ADR-0005](0005-identity-and-authorization.md): the authenticated learner every
  reservation needs
- [ADR-0006](0006-persistence-on-dynamodb.md): conditional writes behind reserve and
  settle
- [ADR-0009](0009-aws-topology-environments-and-operations.md): the budget action
  backstop
- [ADR-0011](0011-llm-integration-and-evaluation.md): the job keys and per-call costs
- [References](../references.md)
