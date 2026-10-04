# Review completion and CI evidence

## Record one phase per diff

Keep task-local run notes outside tracked source. Record repository, issue, PR number
and URL, full head SHA, base SHA/ref and the compared diff, UTC phase start, observation
grace, and any explicit deadline supplied by the user/platform. Record `none specified`
when there is no deadline; do not invent a total time limit. Add request comment IDs,
review/task IDs, timestamps, evidence URLs, and reviewer bot/app identity as they
arrive.

GitHub APIs can return a merge ref rather than the source head for some checks.
Associate that run through the PR's head and base metadata; do not compare arbitrary
green runs by branch name or read the previous head's verdict as current evidence.

## Obtain the review

Discover the connected app's available actions and their schemas. Prefer it over a CLI
whose API reads fail. Read submitted reviews, inline threads and resolution state, PR
conversation, reactions and review task status where exposed. Do not assume a tool
exists merely because another host has one. Record capabilities the app does not expose.
Use successful read-only CLI/API fallbacks only when authorized access is available.

Identify the actual trusted Codex bot/app from repository integration evidence, stable
account/app metadata and prior authenticated review records. A display name, a quoted
review or an arbitrary account saying "Codex" does not establish that identity.

Observe automatic review first. Choose and record an initial observation grace suited to
the service; this only controls when to request a review. If this diff already has a
queued/running request, continue observing it. If no current-diff request is queued,
running or complete after the grace, or there is an explicit skip, post one comment:

```text
@codex review
Review the current PR diff at head <head_sha> against <base_ref>. Focus on the accepted scope and review constraints summarized in the PR.
```

Replace both parameters with the recorded actual values. Record the new comment ID, URL,
creation time and full head/base at submission. The task's request to carry its issue
through Codex review authorizes this targeted comment. Do not post it for a read-only
task. Never duplicate an active request, post `@codex fix`, change review
settings/Smartdetect, or increase credits. Honor the caller's draft/no-merge boundary;
merge-mode readiness follows the validated publication step in the main skill.

The [official GitHub review guide](https://learn.chatgpt.com/docs/third-party/github)
describes the review trigger and the bot's acknowledgement. Acknowledgement is the start
of observation, not proof that review finished.

## Judge evidence, not elapsed time

| Observation from the trusted reviewer                                                 | Verdict                                                                                                                                               |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submitted terminal review or completed review task explicitly naming current SHA/diff | Completion evidence; read every finding before deciding clear.                                                                                        |
| Terminal no-findings result tied to the current request, with current diff verified   | Completion evidence; preserve its identity, correspondence and URL.                                                                                   |
| SHA omitted                                                                           | Require a terminal result, correspondence to the recorded request/task, and evidence that head/diff stayed unchanged throughout; otherwise ambiguous. |
| A thumbs-up                                                                           | Counts only if service semantics or task metadata establish that it is the terminal no-findings result for this exact request/diff.                   |
| Accepted request, queued/running task, eyes reaction, generic thumbs-up               | Pending or ambiguous; never complete.                                                                                                                 |
| Green CI/check, no comments, silence, timeout, local self-review                      | No external review completion evidence.                                                                                                               |
| Explicit skipped review, quota/permission failure                                     | Not completed; request if appropriate or report the access blocker.                                                                                   |
| Evidence for an earlier head or a different diff                                      | Stale; start/observe the current phase.                                                                                                               |

Prefer SHA-bearing submitted reviews and tasks. If API normalization hides a field
needed to prove identity, finality or correspondence, fetch fuller metadata when a read
action exists. Otherwise state what cannot be observed; never infer no findings from an
empty endpoint or report self-review as the external Codex result.

## Fix findings in the main session

Collect all inline and conversation findings, including later findings from the same
review. Record each one's evidence, severity, accepted/rejected/out-of-scope judgment,
reason, fix commit and relevant check. Resolve accepted findings in code before calling
the review clear. A resolved thread flag is not proof that its defect was fixed.
Out-of-scope findings are reported, not silently added to this issue's implementation.

After any pushed correction, record a new head/diff phase and re-obtain current review
and CI evidence. Do not rely on the old terminal review even if the correction seems
small. Follow the same rule when a changed base alters the compared diff. If head or
base changes unexpectedly through someone else's work, pause and preserve their changes.

## Observe CI alongside review

At every observation, refresh the PR head/base and both review and CI state. Diagnose CI
failures while review is still pending. Read workflow/job/step metadata and required
check runs/statuses, following pagination or checking for truncation. Distinguish
success, failure, pending, skipped, cancelled and no checks. An endpoint exposing only
legacy statuses or the first page of PR workflows is not proof that all required checks
were inspected. Compare available evidence with the repository's required check set;
report an inaccessible required check as unverified.

A retry's successful terminal attempt can replace its failed/cancelled attempt for the
same current diff; retain the attempt IDs and explanation. A skipped required check is
not success unless the repository's actual rule explicitly accepts it. Never dispatch
deployment or merge to obtain missing checks.

Use bounded individual waits with progress updates. A tool timeout is an invitation to
refresh state, not a total deadline. Do not invent a total wait budget or a maximum fix
count. Stop on user cancellation, an explicit deadline, an unresolved product decision,
or a quota/permission failure that cannot be safely resolved. Preserve the PR and report
the exact missing review/CI/acceptance evidence.

## Completion condition

Refresh head/base one last time. Hand back only when acceptance is met, every accepted
finding is fixed, a trusted terminal Codex review is clear for the current diff, and
current-head CI plus all required checks are successful. An inaccessible required check
set is a blocker to automatic merge. A green gate and a completed review are independent
facts and must be reported independently. Otherwise report incomplete and missing
evidence.

## Merge or honor the caller's stop point

Explicit skill invocation for issue implementation defaults to merge; a caller's "PR
only", "keep draft", or "do not merge" instruction takes precedence. Analysis or
automatic skill discovery supplies no authority for writes or merge. In stop-at-PR mode,
hand back the reviewed PR in the requested state without closing the issue separately.

In merge mode, refresh the full head, base/diff, review verdict, required checks,
repository merge policy and mergeability immediately before merging. If a changed base
alters the diff or checks, update the branch safely, preserve others' work, rerun the
owed checks and obtain fresh Codex review. Product-conflict decisions still need the
owner. Mark a validated draft ready if necessary, then use the repository's allowed
merge method with an expected-head SHA guard. A head mismatch or blocked merge is not
success: refresh evidence and diagnose it without force-pushing, bypassing rules or
weakening gates.

Verify that GitHub reports merged, record the merge SHA, and verify the selected issue's
closure; report an unexpectedly open issue rather than closing unrelated issues. Move
only this task's clean checkout back to the default branch and update it with ff-only.
Never discard another person's changes or delete unrelated branches/worktrees.

Read post-merge push CI and existing deployment runs for the merge SHA, including events
omitted by a PR-only wrapper. Observe their results and report success, failure,
pending, skipped or not started accurately. Existing automatic dev deployment is a
consequence of the authorized merge; do not dispatch jobs, configure deployment, log in
to AWS or perform manual resource operations. A deployment requiring unavailable access
is a reported blocker, not permission to change credentials. Do not start another issue.
