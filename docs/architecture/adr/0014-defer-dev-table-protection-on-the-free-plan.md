# ADR-0014: Defer the dev table's recovery and deletion protection on the Free plan

- Status: Accepted (2026-09-24)
- Date: 2026-09-24
- Deciders: the owner
- Supersedes: the `dev` column of the two DynamoDB rows in
  [ADR-0009](0009-aws-topology-environments-and-operations.md)'s Stages table and its
  "Data protection" line, and "in every stage" in
  [ADR-0006](0006-persistence-on-dynamodb.md)'s Operations, for `dev` only and until the
  trigger below. `prod` and the rest of both ADRs stand.

## Context

ADR-0009 turns on DynamoDB point-in-time recovery (7 days) and deletion protection for
the `dev` table from the start, because the owner's own learning history accumulates
there for years. ADR-0006 says both are on in every stage.

The `dev` account is on the Free plan, and the owner keeps it there as long as the work
allows (#49). The Free plan's service list includes DynamoDB and names only global
tables as excluded; it does not say whether point-in-time recovery and deletion
protection may be enabled ([references](../references.md#operations-and-cost), checked
2026-09-24). If either is refused, the first Phase 2 deploy fails, and the only fix is
the Paid-plan upgrade.

Phase 2 creates the table, but nothing reads or writes it until Phase 4 puts the API on
Lambda and the owner starts daily use.

## Decision drivers

- Stay on the Free plan as long as the work allows; it charges nothing, which is a hard
  cap while the infrastructure is new.
- Do not let an unverified plan limit block the Phase 2 pipeline.
- Keep the owner's history from being lost to a stack change.

## Considered options

1. **Create the `dev` table without point-in-time recovery or deletion protection, keep
   CloudFormation's retain policy on it, and turn both on at the Paid-plan upgrade.**
2. Keep ADR-0009 as written and upgrade early if the first deploy is refused. Settles
   the question with one failed deploy, but may end the Free plan early for a table that
   holds no data yet.
3. Turn them on and find out. The same as option 2 whenever the Free plan refuses them.

## Decision

Adopt option 1.

- The `dev` table is created without point-in-time recovery or deletion protection.
- Its CloudFormation `DeletionPolicy` and `UpdateReplacePolicy` are `Retain`, so
  deleting the stack, removing the table from it, or an update that would replace it
  leaves the table and its data in place (the `DeletionPolicy` attribute and CDK's
  `RemovalPolicy`, checked 2026-09-24). This costs nothing and needs no plan feature.
- Both are turned on in `dev`, with ADR-0009's 7-day recovery period, as soon as the
  account is on the Paid plan (#49). The work item for it belongs to Phase 4, so the
  phase that starts daily use does not close with the table unprotected.
- `prod` is unchanged: both are on from its first deploy.

## Consequences

### Positive

- Phase 2 deploys on the Free plan whatever the plan allows for these two features.
- No plan decision is forced before there is data to protect.

### Negative

- Until the upgrade, a bad write in `dev` cannot be undone, and the table can be deleted
  directly, from the console or the API; the retain policy only covers changes made
  through the stack.
- The pipeline gains one later change to the stateful stack.

### Follow-ups

- The Phase 4 work item that turns both on after #49.

## Open questions

- None. Whether the Free plan allows these features stays listed as unverified; the
  decision no longer depends on it.

## Sources

- [`DeletionPolicy` attribute](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html)
- [CDK `RemovalPolicy`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.RemovalPolicy.html)
- [Supported AWS services for Sign up for AWS (new)](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html)

## Related

- [ADR-0006](0006-persistence-on-dynamodb.md) — the table and its operations.
- [ADR-0009](0009-aws-topology-environments-and-operations.md) — the stages and their
  settings.
