# ADR-0006: Persistence on DynamoDB

- Status: Accepted (2026-09-23), including the store shape
- Date: 2026-09-23
- Deciders: the owner

## Context

Progress lives in a local SQLite file behind a `ProgressStore` interface
(`src/server/db/types.ts:44-81`). The interface is a port in name, but its shape ties it
to one embedded database:

- **Synchronous.** Its implementation wraps `node:sqlite`'s synchronous `DatabaseSync`
  (`src/server/db/index.ts:47-56`), so every port method returns a value directly and
  every service is synchronous too.
- **Caller-wrapped transactions.** Callers wrap read-modify-write sequences in
  `transaction(body)` (`src/server/db/index.ts:65-75`), for example around closing a
  round (`src/server/services/finish.ts:140`) and ingesting answers
  (`src/server/services/answer.ts:72-76`). A network database cannot hold an interactive
  transaction open across application code like that.
- **Full reads per request.** Each request reads every answer
  (`src/server/services/progress.ts:52`), rebuilds every card's Leitner state
  (`src/core/card-state.ts:23`), and sums points over every finished round
  (`src/server/services/finish.ts:84-86`). The vocabulary prototype hit the same problem
  and moved its hot path to point lookups.
- **Single learner.** No table has a learner column, and settings are one row
  (`src/server/db/migrations.ts:10`).

Some properties are worth keeping:

- Answers carry client-generated ids and are inserted with `INSERT OR IGNORE`
  (`src/server/db/answers.ts:49`), so a resend is harmless.
- A finished round returns its saved summary (`src/server/services/finish.ts:133-135`).

The owner chose DynamoDB for production.

## Decision drivers

- A per-learner boundary that holds structurally
  ([ADR-0005](0005-identity-and-authorization.md)).
- Account deletion and data export for a public service.
- No idle cost, no VPC, no connection management from Lambda.
- Idempotent writes for native clients that resend queued answers
  ([ADR-0007](0007-http-api-contract-and-offline-sync.md)).
- History complete enough to rebuild projections and replay schedulers
  ([ADR-0003](0003-bounded-contexts-and-activity-integration.md)).

## Considered options

| Option                      | For                                                                                                                                                                                                                          | Against                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DynamoDB on-demand (chosen) | Pay per request; conditional writes; one partition per learner makes isolation, deletion and export one key.                                                                                                                 | Access patterns must be designed up front. Ad hoc analytics need an export.                                                                                                                                                |
| Aurora DSQL                 | PostgreSQL-compatible, so today's SQL survives. Available in ap-northeast-1. Billed per DPU ($8 per million DPU in us-east-1) plus storage; the free tier includes 100,000 DPU and 1 GB-month per month; idle uses zero DPU. | Repeatable Read only; at most 3,000 rows changed per transaction; no SAVEPOINT; optimistic concurrency, so a commit can fail and must be retried from the start. Locally it is replaced by PostgreSQL, a different engine. |
| Aurora Serverless v2        | Full PostgreSQL. Can scale to 0 ACU with auto-pause on supported versions.                                                                                                                                                   | Unverified: that it can be reached without placing the Lambda in a VPC. A VPC plus NAT for outbound calls would add the fixed hourly cost this design avoids.                                                              |
| SQLite on EFS               | Keeps the current code.                                                                                                                                                                                                      | Rejected: a single-writer file on a network filesystem under concurrent Lambdas, with a VPC required.                                                                                                                      |

## Decision

### Store shape

These changes apply whichever database sits behind the port:

- **Asynchronous.** Every port method returns a `Promise`.
- **Learner-bound.** The application obtains `stores.forLearner(learnerId)`. Methods
  never take a learner id; the adapter adds it to every key.
- **Command-shaped commits replace `transaction(body)`.** A command loads what it needs,
  then a pure `decide` returns the changes and the conditions they depend on. One commit
  applies them atomically or fails:

```ts
interface Commit {
  readonly puts: readonly Item[]; // new log entries, new rounds
  readonly updates: readonly Update[]; // projections
  readonly expect: readonly Condition[]; // e.g. round is open; answer id is new
}
// DynamoDB: one TransactWriteItems with condition expressions.
// In-memory fake: check every condition, then apply.
// A failed condition surfaces as a typed conflict, e.g. ERR_ROUND_CLOSED.
```

- **Projections instead of full replays.** An item's memory state and the learner's
  totals (points, completed days, current level) are stored and updated in the same
  commit that appends to the log. Reads become point lookups.
- **Append-only logs.** Answers and reviews are never updated. Projections can be
  rebuilt from them with a script, which is also how a scheduler change is applied
  ([ADR-0003](0003-bounded-contexts-and-activity-integration.md)).

### Table sketch

One table for learner data, with one partition per learner:

```text
PK                    SK                                   item
LEARNER#<learnerId>   PROFILE                              timezone, L1, target, UI locale
LEARNER#<learnerId>   SETTINGS                             topics, focus, daily size, sound
LEARNER#<learnerId>   STATS                                points, completed days, level
LEARNER#<learnerId>   LEVEL#<at>                           level history entry
LEARNER#<learnerId>   ROUND#<roundId>                      kind, day, deck, status, summary
LEARNER#<learnerId>   ROUND#<roundId>#ANSWER#<answerId>    log entry (ADR-0003 envelope)
LEARNER#<learnerId>   PORTION#<day>                        target, completedAt
LEARNER#<learnerId>   ITEM#<kind>#<itemId>                 memory state (projection)
LEARNER#<learnerId>   TITLE#<key>                          awarded title
IDENTITY#<sub>        LEARNER                              sub → LearnerId mapping
```

- A round and its answers are one `Query` on a key prefix.
- Due items are one `Query` on `ITEM#`. A learner holds at most a few thousand items, so
  a secondary index on due date is not needed yet.
- Deleting or exporting an account means querying one partition, plus the identity
  mapping item.

The ledger ([ADR-0010](0010-entitlements-and-billing.md)) and any job state get their
own key prefixes, or their own table if their access patterns diverge.

### Idempotency and offline sync

- An answer is written with an `attribute_not_exists` condition on its key, so a resent
  answer changes nothing. This is the same guarantee `INSERT OR IGNORE` gives today.
- `answeredAt` becomes a client-reported value. It must fall between the round's start
  and the server's now. Today the server stamps it (`src/server/services/answer.ts:66`),
  which would misplace answers queued offline.
- A late answer still belongs to its round's day
  (`src/server/services/answer.ts:47-51`), including a round abandoned when a newer one
  started (`src/server/services/start.ts:137`).

### Operations

- On-demand capacity. DynamoDB bills per request, with no capacity to plan and no charge
  for idle capacity.
- Point-in-time recovery and deletion protection are on. The table belongs to the
  stateful stack ([ADR-0009](0009-aws-topology-environments-and-operations.md)).
- Analytics come later, through an export to S3. Nothing reads the live table for
  reporting.

### Local development and tests

- An in-memory fake implements the port for unit and application tests.
- DynamoDB local runs the adapter's contract suite and backs local development. The same
  suite, including the learner-isolation contract from
  [ADR-0005](0005-identity-and-authorization.md), runs against both the fake and the
  real adapter.
- `node:sqlite` and the SQLite adapter are retired when the API cuts over. The owner's
  existing local progress can be carried over with a one-off import script.

## Consequences

### Positive

- The learner boundary is part of the key, so isolation, deletion and export follow from
  it.
- Request cost no longer grows with a learner's history.
- One contract suite defines what "a store" means, whatever the implementation.

### Negative

- Leaving SQL means every new read must be designed as a key access pattern first.
- Projections can drift from the log if a commit path forgets to update one. Rebuild
  scripts and contract tests are the mitigation.
- Local development needs DynamoDB local, which today's zero-dependency setup does not.

### Follow-ups

- Write the port and its contract suite first, then the in-memory fake, then the
  DynamoDB adapter.
- Specify each command's conditions in its `decide` tests, so a conflict is a tested
  outcome rather than an exception.

## Open questions

- A transaction holds at most 100 actions, and no two actions may target the same item
  (verified 2026-09-23). A round's finish (round, portion, stats, level, titles, and
  item states for up to 30 cards) fits, but a finish that also carried every answer of a
  30-card round with retries would not. Hence answers are committed as they arrive and
  finish commits the aggregates; whether finish should also accept a final batch of
  queued answers in the same call is open.
- DynamoDB local supports the transactional APIs (since 2019) but not point-in-time
  recovery; whether its condition-expression behaviour matches the service in every case
  the contract suite exercises is to be confirmed by running the suite against both.
- Whether the log moves to its own table once analytics exports make that convenient.

## Sources

AWS documentation, checked 2026-09-23:

- DynamoDB pricing (on-demand): https://aws.amazon.com/dynamodb/pricing/
- Condition expressions:
  https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html
- Aurora DSQL PostgreSQL compatibility and transaction limits:
  https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html
- Aurora DSQL pricing and free tier: https://aws.amazon.com/rds/aurora/dsql/faqs/ and
  https://aws.amazon.com/rds/aurora/dsql/pricing/
- Aurora DSQL optimistic concurrency:
  https://aws.amazon.com/blogs/database/up-and-running-with-apache-ofbiz-and-amazon-aurora-dsql/
- Aurora DSQL and SAVEPOINT:
  https://aws.amazon.com/blogs/database/building-python-applications-with-sqlalchemy-and-aurora-dsql/
- Aurora Serverless v2 scaling to zero:
  https://aws.amazon.com/blogs/database/introducing-scaling-to-0-capacity-with-amazon-aurora-serverless-v2/
- NAT gateway pricing: https://aws.amazon.com/vpc/pricing/
- Transaction limits (100 actions; one action per item):
  https://aws.amazon.com/blogs/database/a-framework-for-amazon-dynamodb-transactions/
  and https://aws.amazon.com/blogs/aws/new-amazon-dynamodb-transactions/
- DynamoDB local transactional APIs:
  https://aws.amazon.com/blogs/database/2019-the-year-in-review-for-amazon-dynamodb/ and
  usage notes (no PITR):
  https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html

## Related

- [ADR-0003](0003-bounded-contexts-and-activity-integration.md) — the log envelope
- [ADR-0005](0005-identity-and-authorization.md) — learner-bound stores and the
  isolation contract
- [ADR-0007](0007-http-api-contract-and-offline-sync.md) — client ids and queued answers
- [ADR-0009](0009-aws-topology-environments-and-operations.md) — stacks and backups
