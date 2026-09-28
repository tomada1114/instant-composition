---
name: shipping-issues
description: >-
  Rank open GitHub Issues by their `priority: P0`-`P3` labels, backfilling missing ones,
  then implement the top issue, review it with /code-review, open a PR that closes it,
  watch CI to green, merge, and return to the default branch. Pass "all" to work through
  every issue in dependency order, independent ones in parallel git worktrees. Use when
  asked to ship the remaining issues, take on the next issue, or clear the ticket
  backlog.
---

# Shipping Issues

**Done means all three:** the PR is merged to the default branch, the issue is CLOSED,
and nothing was deleted or weakened to get there.

**Invoking this skill is the authorization for every write it makes, up to and including
the merge** — labels, branches, pushes, the PR, follow-up issues, step 8b's design
comments, cleanup. Green CI is the go-ahead: when [step 6](#6-ci-to-green) reports
`PASS`, merge in the same turn, with no "shall I merge?". The only pauses are the
[Stop conditions](#stop-conditions), a genuinely tied top two at step 2, and `NO_CHECKS`
at step 6.

This session holds the selection, the judgment and every GitHub write; sub-agents do the
reading-heavy work. Every spawn is `executor` (Opus 5.5, low effort) or `architect`
(Opus 5.5, high effort), by `subagent_type` — never a bare `model`, which inherits this
session's effort instead:
[cost-discipline.md#model-and-effort-assignment](references/cost-discipline.md#model-and-effort-assignment).

## Modes

| Argument            | Behavior                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(none)_            | Ship the highest-priority shippable issue, then continue through **its own output only** — the follow-ups it filed, the designs it unblocked ([step 8c](#8c-take-the-runs-own-output-back-into-the-queue)). Never reaches back into the wider backlog. |
| `all`               | Ship every shippable issue, in dependency-then-priority order. Independent issues are implemented and reviewed in parallel, one git worktree each; PR, CI watch and merge stay serialized. Follow-ups this run files join the same queue.              |
| a number, e.g. `42` | Ship that specific issue, after checking nothing it depends on is still open.                                                                                                                                                                          |

A count or concurrency in the argument — "10個ぐらい", "3 at a time" — is
`--max-parallel` for `plan.py` (default 3; raise it only because the user asked).
Anything else is a filter hint (a label, a milestone) — pass it as `plan.py` flags.

An issue labeled `blocked: design`, or with `design=open` in its
[ship contract](references/ship-contract.md), is never implemented automatically, even
under `all` — only by naming its number or passing `--include-design`
([step 2b](#2b-decide-a-design-that-gates-the-pick)).
[Step 8b](#8b-unblock-held-designs-in-the-background) sends a background agent after
every such issue instead.

## Working rules

- **One checkout, one writer.** Step 1 decides the arrangement once for the whole batch:
  **serial** works in the main checkout; **parallel** gives each issue a worktree under
  `<runstate>/worktrees/<n>` and leaves the main checkout clean on the default branch.
  Never re-decide mid-batch.
- **Concurrency stops at the GitHub API.** Steps 3 and 4 run concurrently across a
  batch; everything that talks to GitHub stays in this session, one PR at a time.
- **Nothing waits on the user mid-run.** A command behind an approval prompt (the
  `rm -rf` family) stalls an unattended run. Use a prompt-free equivalent (`mv` into the
  holding area), else defer it to the one end-of-run confirmation, and run it mid-run
  only when the issue cannot move without it:
  [closing-out.md#approval-gated-commands](references/closing-out.md#approval-gated-commands).
- Every issue starts from a clean, up-to-date default branch, and the run returns there
  after every merge (`git switch <default> && git pull --ff-only`).
- **The run record is the memory.** A long run gets its context compacted. What landed,
  what is in flight and what was deferred is in `<runstate>/run.md`: after a compaction,
  or whenever unsure, read it back and re-plan the way step 7 does
  (`--refresh --allow-existing-worktrees`) rather than trusting recollection.
- A dirty working tree this run did not create is never touched —
  [Stop conditions](#stop-conditions).

## Inputs and outputs

Reads the repo's open issues and PRs and its `CLAUDE.md` / `AGENTS.md`. Writes
`priority:` and `blocked: design` labels, design-decision comments, branches, PRs,
merges, issue closures, follow-up issues, and a run record. Requires `git`, `python3`,
`gh`.

Everything generated lives under `<runstate>` —
`${AGENT_SKILL_STATE_DIR:-$HOME/.local/state/agent-skills}/shipping-issues/<owner>__<repo>/`
— **never inside a checkout**, worktrees included, where it would read as untracked
content. Layout: [run-record.md](references/run-record.md). Record each event as it
happens:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/run_record.py --repo <owner>/<repo> \
    --event <kind> [--field k=v ...] [--body-file <path>]
```

## Workflow

### 1. Plan — one call

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/plan.py --mode <all|single|N> \
    [--max-parallel N] [--label L] [--assignee A] [--milestone M] \
    [--include-design] --record
```

Preflight, ranking, selection, repo profile and parallel grouping in one block. Read it;
do not re-derive any of it ([plan-output.md](references/plan-output.md)). Four fields
carry a duty:

- `preflight: BLOCKED` stops the run. `tree: DIRTY` is a question to ask **now**, before
  any baseline. `existing-worktrees: BLOCKED` is a [stop condition](#stop-conditions).
- `verify-check:` is a **guess** from script names. Confirm it is the gate this repo
  runs before a PR (not just the unit tests) and that it terminates (not a watcher).
- `needs-design:` — spawn [step 8b](#8b-unblock-held-designs-in-the-background)'s round
  **here, before step 3**.
- `stale-labels:` — run the `--clear-dependency` command it prints, without asking.

`labels: COMPLETE` → skip step 2. `github: write=no` → rank from `~P<n>` suggestions and
report findings instead of writing them.

### 2. Label the unlabeled — only when the plan says so

- **≤3 without a settled tier** — read them (`issue_digest.py --detail N --detail M`)
  against [priority-rubric.md](references/priority-rubric.md), then
  `apply_priority_labels.py --backfill --set N=P0 --quiet` (`--backfill` writes the
  suggested tier to every unlabeled issue; `--set` overrides the ones judged otherwise).
- **More, tangled edges, or a close top-two** — an `executor` with
  [agents/priority-research.md](references/agents/priority-research.md), filled per
  [delegation-templates.md](references/delegation-templates.md).

Run without asking; readiness gate:
[dependency-triage.md](references/dependency-triage.md). Re-plan
(`plan.py --refresh --record`) and proceed, unless the top two are genuinely tied on
every axis or the pick needs a product decision.

### 2b. Decide a design that gates the pick

Only for a design-blocked issue taken on deliberately. Settle the approach, record it,
and clear the block before step 3, per
[dependency-triage.md#deciding-a-held-design](references/dependency-triage.md#deciding-a-held-design).

### 2c. Confirm the proposed batch

The plan proposes a parallel batch; this step decides. Check each pair against
[dependency-triage.md#parallel-vs-sequential-all-mode](references/dependency-triage.md#parallel-vs-sequential-all-mode):
`MECHANICAL` → read each issue's real reach against its declared `touches=`; `PARTIAL` →
read the undeclared issues properly. Where step 2's research agent grouped differently,
take the narrower grouping. Shrinking a batch never needs asking.

### 3. Implement

One issue = one branch = one PR. Step 1's `next:` line is the command.

**Serial** — `git switch <default> && git pull --ff-only && git switch -c <branch>`,
then run the confirmed verification command once, unmodified, into
`<runstate>/verify/<n>-baseline.log`.

**Parallel** — pull the default branch once, then provision **the first worktree
alone**, read its block, and only then the rest (a repo that cannot carry a worktree
costs one install, not three):

```bash
${CLAUDE_SKILL_DIR}/scripts/worktree_setup.sh --spec <n>:<branch> \
    --spec <m>:<branch> --base <default_branch> --root <runstate>/worktrees \
    --log-dir <runstate>/verify --verify "<confirmed verify command>"
```

It reports and does not decide: judge the `baseline:` outcome yourself
([recovery.md#a-red-baseline](references/recovery.md#a-red-baseline)). Read exit codes
and log tails, never full output; what the baseline turns up goes to step 8.

Spawn one sub-agent per issue with
[agents/implementation.md](references/agents/implementation.md): **`executor` by
default, `architect` when the issue is foundational** — blast radius, not difficulty
([the foundation exception](references/cost-discipline.md#the-foundation-exception-architect-for-what-the-backlog-builds-on)).
A change smaller than its handoff is implemented here instead
([the floor](references/cost-discipline.md#the-floor-too-small-to-delegate)). In
parallel mode issue the whole batch **in one message**, each on its own worktree.

Then **judge each result here**, against the issue and step 2b's decision:

| Returned field               | Consumed                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCEPTANCE`                 | **Here, first.** A `not-met` line is work still owed — send it back. Green CI proves the repository still works, not that the issue was answered. |
| `UNRESOLVED`                 | **Here.** Each judgment call the agent made alone is accepted (and stated at step 10) or sent back, never silently inherited.                     |
| `PR-SUMMARY` / `TEST-PLAN`   | [Step 5](#5-open-the-pr), verbatim.                                                                                                               |
| `MEASURE`                    | [Step 4](#4-review-the-branch) — what review findings are checked against.                                                                        |
| `SCOPE-NOTES` / `FOLLOW-UPS` | [Step 8](#8-close-out-the-findings-the-run-turned-up).                                                                                            |

Send work back by **continuing the same agent** (`SendMessage` in Claude Code) with only
what is left — a fresh spawn re-learns everything the first one read
([why](references/cost-discipline.md#where-the-cost-of-a-spawn-actually-goes)). At most
**2 patch rounds** on top of the first run; a third miss is `NEEDS-CLARIFICATION`. A run
that returned without its report, stopped before pushing, or widened the spec:
[recovery.md](references/recovery.md) — never re-spawn an agent that returned without
its report.

### 4. Review the branch

Before any PR exists. In parallel mode review every branch in the batch, triage all of
them, then fix them concurrently; no PR opens until the last triage is done. One pass:
fix every accepted finding here and do not re-review after the fix.

```
/code-review medium <branch> [--fix]
```

**Effort first, branch second** — an unrecognized first token makes the whole string the
target and silently reuses the last effort. **`medium` for every branch**; `high` only
where the change can corrupt existing data or the user asked; never `low` or `ultra`:
[cost-discipline.md#code-review-effort](references/cost-discipline.md#code-review-effort).

**`--fix` is serial-mode only** — in parallel mode it would write into the main
checkout. There, review without it and spawn one `executor` per branch with accepted
findings, all in one message, from
[agents/review-fix.md](references/agents/review-fix.md) — numbering the findings `F1`,
`F2`, … so the returned `APPLIED`/`REJECTED` lines match back
([why](references/recovery.md#--fix-and-why-it-is-serial-mode-only)). Host won't launch
`/code-review` → [agents/review-fallback.md](references/agents/review-fallback.md).

**Triage** every finding against the issue's scope before anything is written. What
belongs in this diff is the same behavior change the issue is about, tests included; a
schema change or a new public surface does not, however small
([filing-followups.md](references/filing-followups.md)) — route it to step 8.

Then **read what the fix pass changed** (`git -C <workdir> diff <impl-commit>..HEAD`),
revert what it got wrong, and read what it would _not_ apply (`skipped` / `REJECTED`) —
real-but-out-of-scope goes to step 8. Re-run verification in `<workdir>` only if
something changed, then push. Record per branch:
`--event review --field issue=<n> --field status=<code-review|code-review+agent-fix|DELEGATED> --field effort=<medium|high> --field findings=<n> --field skipped=<n>`
— `skipped` counts refusals from either path.

### 5. Open the PR

From here to step 7 the run is serial in both modes: finish one issue's PR → CI → merge
before opening the next, in dependency-then-priority order.

Commits but nothing pushed → `git -C <workdir> push -u origin <branch>`. No commits →
`--event blocked --field issue=<n>`, report `SKIPPED(<why>)`, move on in `all` mode.

Open the PR against the **default branch** (auto-close fires only there), titled
`<PR-TITLE>`, body `PR-SUMMARY`, then **`Closes #N`** (a bare `#N` closes nothing), then
`TEST-PLAN`. Record `--event pr-created --field issue=<n> --field pr=<url>`, then catch
a missing link or `WRONG_BASE` before CI spends time on it:

```bash
${CLAUDE_SKILL_DIR}/scripts/link_check.sh <pr> --issue <n> --fix
```

`--fix` appends a missing `Closes #N`; `WRONG_BASE` → retarget before merging.

### 6. CI to green

Wait until the PR's new head commit appears among the branch's CI runs — a watch started
earlier reads the previous commit's verdict. Then, redirected so failing-log tails stay
out of this context:

```bash
${CLAUDE_SKILL_DIR}/scripts/ci_watch.sh <pr> --timeout 1800 > <runstate>/ci/<pr>.log
grep -E '^(verdict|mergeable|merge_state|review_decision):' <runstate>/ci/<pr>.log
```

This is the run's only wait primitive — never a hand-rolled sleep loop, never
backgrounded: block on it, one PR at a time, even in `all` mode. Keep `failed_checks:`
for repair. Record `--event ci`. `FAIL` →
[recovery.md#ci-fails](references/recovery.md#ci-fails) with
[agents/ci-repair.md](references/agents/ci-repair.md), at most 3 attempts. `NO_CHECKS` /
`ERROR` →
[recovery.md#no_checks-error-and-other-non-verdicts](references/recovery.md#no_checks-error-and-other-non-verdicts).
`PASS` → step 7, same turn.

### 7. Merge and confirm the issue closed

```bash
${CLAUDE_SKILL_DIR}/scripts/land_pr.sh <pr> --issue <n>
git switch <default_branch> && git pull --ff-only
```

Read `result:` and `issue:` — one of the six results must never read as success:
[landing-outcomes.md](references/landing-outcomes.md). Record `--event merged`. The run
never ends parked on a feature branch.

**Serial `all`:** re-plan (`plan.py --mode all --refresh --allow-existing-worktrees`)
and start the next step 3 without pausing. **Parallel `all`:** bring each remaining
branch up to date in its own worktree **before its own step 5**, by merge, not rebase
([how](references/recovery.md#bringing-the-rest-of-a-parallel-batch-up-to-date)); a
conflict means the grouping was wrong for that pair
([recovery.md#a-merge-conflict](references/recovery.md#a-merge-conflict)). Group the
next batch only once the whole batch has merged.

### 8. Close out the findings the run turned up

Three outcomes, in order of preference: **fix it in the diff already open** · **file it
and ship it in this run** ([step 8c](#8c-take-the-runs-own-output-back-into-the-queue))
· **file it and leave it**. Out of scope for the diff is not out of scope for the run.
**Read [filing-followups.md](references/filing-followups.md) before filing anything.**

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/file_followup.py \
    --title "<repo's title convention>" --body-file <path> \
    --tier P2 --area <area> --touches <paths> --label <area label> \
    --found-while <n> [--needs-design]
```

`--tier` is required even with `--needs-design`, which is for an open design question,
not a verified fix. Exit 2 (`NO_WRITE_ACCESS`) → report the finding at step 10. File
right after the PR that surfaced it lands; record `--event followup`; pass `--refresh`
on the next plan.

### 8b. Unblock held designs in the background

Each design-blocked issue — step 1's `needs-design:` once per run, plus everything this
run files `--needs-design` as soon as it is filed — gets one **`architect`** from
[agents/design-decision.md](references/agents/design-decision.md). **Spawn and move on;
never block on one.** Cap 3 in flight, a round issued in one message; when one returns,
record it (`--event design`) and spawn the next queued one in the same turn, whatever
step the shipping path is on. `DEFERRED` is a correct outcome, not a stop: its
`OPEN-QUESTION` goes to the user at step 10. Queue order and the returned fields:
[delegation-templates.md#design-decision-step-8b](references/delegation-templates.md#design-decision-step-8b).

### 8c. Take the run's own output back into the queue

Before cleanup, re-plan (`plan.py --mode <same> --refresh --allow-existing-worktrees`;
with an explicit issue number, re-plan each candidate by its own number) and run steps
3–8 on what **this run produced** — step 8's follow-ups and step 8b's `DECIDED` issues —
when all three hold:

1. **Depth 1** — it came from this run's own work; a follow-up of a follow-up waits.
2. **Shippable** on the ordinary
   [readiness gate](references/dependency-triage.md#readiness-gate); `DEFERRED` is not.
3. **[Budget left](references/cost-discipline.md#run-budget)**; otherwise, or with a
   design agent still in flight once everything else is done, stop and name it.

In `all` mode these join the queue with no privilege. Otherwise this step is the only
thing that extends the run past its first merge.

### 9. Clean up

**Once, after the last merge, script only** — `rm` is never used anywhere in the run;
what has to go mid-run is moved into `<runstate>/holding/<n>/`
([closing-out.md#cleanup-scope](references/closing-out.md#cleanup-scope)). `HEAD` is
already on the default branch, which the branch deletion requires. Pass every branch
this run created as `--branch`: without it the script deletes every merged-PR branch in
the repository, other people's included.

```bash
${CLAUDE_SKILL_DIR}/scripts/cleanup_run.sh --branch <name> [--branch <name> ...] \
    [--remote] [--dry-run] [--worktree-root <runstate>/worktrees] [--merged-only] [--force]
${CLAUDE_SKILL_DIR}/scripts/preflight.sh \
    --profile-cache <runstate>/repo-profile.json --set-worktree-viable <yes|no>
```

`--worktree-root` only when this run created worktrees
([what is lost with them](references/recovery.md#a-worktree-that-will-not-go-away)); the
second call only when this run probed worktree viability. Record `--event cleanup`.

Anything in `<runstate>/holding/` or `<runstate>/deferred.md` from this run is listed in
the step 10 report, and one approval-gated call covering all of it is the run's **final
tool call**, after the report text:
[closing-out.md#the-final-confirmation](references/closing-out.md#the-final-confirmation).

### 10. Report

No prescribed format; the facts whose absence would mislead are fixed:
[closing-out.md#what-the-report-must-not-omit](references/closing-out.md#what-the-report-must-not-omit)
— above all any issue left open behind a merged PR, any criterion shipped `not-met`, and
every `DEFERRED` design's open question.

## Stop conditions

Stop the whole run and report when: the plan is `BLOCKED`, a dependency cycle needs a
human, a merge conflict needs a product decision, or the same CI failure survives the
retry ceiling on two different issues.

Also stop on **a change in the repository this run did not make** — the main checkout
dirty with files no step touched, a branch moved underneath you, the default branch
ahead of the last merge, a worktree under this run's root it did not create. Prove it is
not yours first by comparing the actual hunks with your own branches and worktrees
(touching a file your issue also edits proves nothing either way), then leave it exactly
as found (no stash, no restore, no commit), record
`--event blocked --field reason=<...>`, and ask. Someone else's uncommitted work is
unrecoverable once discarded, and a gate failing on their half-finished edit is not
yours to fix.

In `all` mode a single failed issue does not stop the run: mark it FAILED, record it,
skip what depended on it, continue. A background design returning `DEFERRED` stops
nothing; only a design blocking the issue being implemented does, at step 2b.

## Further reading

[cost-discipline.md](references/cost-discipline.md) — context budget, run budget, tiers,
what a spawn and parallel mode cost · [recovery.md](references/recovery.md) — everything
that can go sideways between step 3 and step 7 ·
[delegation-templates.md](references/delegation-templates.md) — the six sub-agent
prompts and the rules every spawn shares.
