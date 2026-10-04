# Issue eligibility in Cloud

Build a compact table before choosing: issue, current owner policy, acceptance checks,
dependencies with state/reason, related PRs or claims, capabilities needed, and verdict.
Fetch the complete body and all comments for the leading candidates. If the available
search action omits labels, close reasons or comments, fetch those separately. Missing
data is unknown, not a successful check. Follow pagination where supported; report a
truncated result instead of claiming the entire backlog was inspected.

## Acceptance is the boundary

| Acceptance condition                                                                 | Eligible with the checked environment?                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| TypeScript, scripts, contracts, signed-token/fake-provider tests, DOM fixtures       | Yes; use the relevant repository suite.                                              |
| Docker DynamoDB fixtures, web build, HTTP smoke, coverage, CDK synth without lookups | Yes when their tools and local service are available.                                |
| Concurrent or repeated local tests                                                   | Yes in the Cloud VM; retain the issue's repetition/load requirements.                |
| Live AWS reads/writes, a deployed alarm's history, real Bedrock latency              | No under the current unauthenticated workflow; code/CI alone cannot meet acceptance. |
| Real browser/login/cookie jar, focus/layout, microphone, owner's device              | No under this workflow; a DOM or HTTP smoke pass is not the requested evidence.      |
| A paid live model request                                                            | No; a saved key does not authorize the call or supply network access.                |

An issue touching AWS or authentication can still qualify if its accepted checks are
offline assertions and injected fakes. Conversely, an otherwise small infrastructure
change does not qualify when its close condition includes the next real deployment. Use
current acceptance text rather than classifying by labels or keywords alone.

The
[official Cloud guide](https://learn.chatgpt.com/docs/environments/cloud-environments)
currently lists browser/computer use as unsupported. Do not install a browser tool as an
assumed substitute or auto-complete browser acceptance. Missing AWS credentials or
network authorization are current access limits, not proof that Cloud can never reach
AWS. Request a separate decision about such work instead of changing saved settings.

## Dependencies and ownership

- Distinguish an actual prerequisite from a contextual issue mention.
- Follow real prerequisites recursively, checking current comments and resolution. A
  dependency closed as completed needs evidence its required behavior landed and remains
  applicable. A merged PR is useful evidence; closure alone is not enough.
- `not_planned`, duplicate closure, cancelled work and deferred comments are not
  implementations. Trace a duplicate to its replacement and accepted resolution. Treat
  unavailable close reasons or contradictory owner decisions as unresolved.
- Check draft and ready PRs, recent issue comments claiming work, local branches and
  worktrees. A matching number is not the only conflict: inspect overlapping paths and
  acceptance scope. Prefer another eligible issue when work is already active.
- Recheck the chosen issue and related PRs before implementation. If another actor
  starts overlapping work, preserve both and report the conflict; do not force-push over
  their branch or extend their PR without explicit authorization.

## Examples observed on 2026-10-04

These illustrate the decision; refresh their current bodies/comments before using them.

- [#456](https://github.com/tomada1114/instant-composition/issues/456) qualifies despite
  changing Cognito login: it explicitly asks for fake Cognito, DOM tests and CDK
  assertions, and excludes actual login/browser/device verification.
- [#443](https://github.com/tomada1114/instant-composition/issues/443) requires export
  and restoration of DynamoDB Local fixtures, not restoration of real learner data.
- [#468](https://github.com/tomada1114/instant-composition/issues/468) needs three
  successful full gate runs while another test process runs; one green CI is
  insufficient.
- [#467](https://github.com/tomada1114/instant-composition/issues/467) needs alarm
  history after the next dev deployment; offline tests cannot finish its acceptance.
- [#331](https://github.com/tomada1114/instant-composition/issues/331) needs real model
  timing and a dev conversation backed by Bedrock; recorded responses cover only part.
- Parent issues [#374](https://github.com/tomada1114/instant-composition/issues/374) and
  [#322](https://github.com/tomada1114/instant-composition/issues/322) include dev
  browser acceptance; passing their child code suites does not close the parent.
