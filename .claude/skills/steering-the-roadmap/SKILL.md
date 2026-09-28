---
name: steering-the-roadmap
description: >
  Covers deciding what to work on next and keeping docs/architecture/roadmap.md and the
  GitHub phase issues ("Phase N — …" parents and their sub-issues) in step with the
  owner's intent. Use when asked which issue or phase to take on next, before invoking
  shipping-issues, when the owner wants to reorder phases or add, drop, defer or reshape
  a feature, when a phase starts and needs its work items cut, when a phase's work items
  are all closed, when the owner asks for a small change after using the app (a key
  binding, a default, a tuning value), or when asked for the project's status or plan.
---

# Steering the Roadmap

**Owns:** what gets worked on next and why; the mapping between the roadmap's phases and
the tracker; turning the owner's change of mind into a plan change that is written down.
**Does not own:** the decisions themselves and how the architecture pages are written
(`recording-architecture-decisions`); what a label means and what an issue body holds
(`triaging-issues`); implementing, reviewing and merging an issue (`shipping-issues`).

This skill is a project manager for one owner. It knows the plan in detail, and it bends
when the owner changes their mind. A change of mind is expected, not a problem to argue
down: the job is to make its consequences visible, then write the new plan down so the
next session starts from it.

## Where the plan lives

The plan has two homes and no third:

- **`docs/architecture/roadmap.md`** holds the phases, their order, scope and exit
  criteria. Its "How the work is tracked" section sets the tracker conventions. The ADRs
  it links say what each phase builds, and why.
- **GitHub** holds one parent issue per phase, titled "Phase N — …" and labelled
  `on hold`. The phase's work items are sub-issues of that parent, ordered by
  `Depends on: #N` lines. The parent and every work item carry `phase: N`, so a listing
  shows the phase without opening an issue. There are no milestones and no dates. Beside
  the phases, open issues labelled `improvement` form a standing lane with no parent and
  no phase label ([below](#improvements-from-daily-use)).

Do not keep a plan anywhere else: no notes file, no memory entry, no TODO list in a
comment. A decision that changes the plan lands in one of those two homes, or it is lost
at the end of the session.

Read the state; never recall it. Before any recommendation, run the status query in
[tracker-commands.md](references/tracker-commands.md) and read the roadmap. The issues
and the page change between sessions, and a remembered state is exactly the kind that
has gone stale.

## Deciding what is next

Reason in this order, and say which step decided the pick:

1. **Improvements first.** A ready `improvement` issue goes ahead of phase work. It is
   small, and it is friction the owner meets every day; the owner chose this order.
2. **Phase order.**
   - Phases 0–4 are fixed. So are 10–13.
   - The owner orders 5, 6, 8 and 9 as they use the app; 7 follows 6.
   - Work inside the earliest phase that still has open work, unless the owner says
     otherwise.
3. **Readiness.** An item is ready when every `Depends on:` issue is closed and it
   carries neither `blocked: design`, `blocked: external` nor `on hold`.
   - A stale `blocked: dependency` whose blockers are all closed is ready. Clear the
     label; do not read around it.
4. **Leverage.** Among the ready items, prefer the priority label first. Then prefer the
   item that unblocks the most other items.
5. **The owner's intent overrides all of this.** Before acting on an override, say what
   it costs: which dependency it jumps, what it leaves half done, and which exit
   criterion it delays.

Surface anything only the owner can clear when it gates the pick. That means a
`blocked: external` step, a `blocked: design` choice, or an owner decision the roadmap
names. An example of the last is the AGENTS.md "Rate limiting" amendment before any
ledger code. Put these first in the answer, because nothing else moves until the owner
acts.

Recommend one to three candidates, not the whole backlog. Give each its number, a
one-line reason and the recommendation, and ask the owner to pick.

## Handing off to `shipping-issues`

**REQUIRED:** `shipping-issues` does the work, but only after the owner has confirmed
the pick. Invoking it authorizes every write it makes, up to the merge, so never invoke
it on this skill's own choice.

- Pass it a single issue number by default.
- Pass `all` only when the owner asks for the whole ready queue. Say first how far that
  queue reaches (for example "all of Phase 0 and Phase 1"). `all --label improvement`
  limits it to the improvement lane.

When it returns, run the status query again, then do the following:

- **Every work item of a phase is closed.** Check the phase's exit criteria with the
  commands and tests the roadmap names.
  - If they hold, close the phase's parent issue, then mark the phase as landed in the
    roadmap. **REQUIRED:** `recording-architecture-decisions`.
  - If one fails, file the missing work as a new sub-issue. Never close the phase over
    it.
- **The next phase has no work items.** Offer to cut them (below).

## When the plan changes

For each change the owner asks for:

1. **Restate it with its consequences.**
   - What moves, and what depends on it.
   - Which ADR decision it touches, if any.
   - What it costs in money or time, with figures from verified sources only.
2. **Classify it:**
   - **Order or scope inside the existing design.** Edit the roadmap, then update the
     tracker to match: parents' titles and bodies, `Depends on:` lines, labels and
     sub-issue links. An item that moves phase swaps its `phase: N` label and its
     sub-issue link together.
   - **A change to an ADR decision** — a context boundary, a persistence shape, a
     contract, a provider or the security model. **REQUIRED:**
     `recording-architecture-decisions` first: the ADR rewritten in place, or a
     superseding one when the decision is replaced whole. Then the roadmap, then the
     issues.
   - **A new idea.** Add it as a scope line in the right phase, or as a new phase if it
     stands alone. It gets issues only when that phase comes within reach.
3. **Get the owner's approval, then apply everything together.**
   - Land the roadmap change as a pull request.
   - Edit the tracker in the same sitting, so the page and the issues never disagree for
     long.
4. **Report what changed, with links.**

Never do any of these silently:

- change the order of Phases 0–4;
- move production ahead of the planned features;
- close a phase whose exit criteria were not observed;
- re-tier issues away from the roadmap's order without writing down why.

## Cutting a phase into work items

Do this when a phase comes within reach: the phase before it is nearly done, or the
owner asks.

- Read the phase's roadmap section, the ADRs it realizes, the code as it stands, and the
  skills that exist now. The code has moved since the phase was written, so re-read it
  rather than trusting the phase text.
- Make each work item one pull request. Its body holds what is wrong today with a
  `path:line`, "Done means" as a command or test, and `Depends on:` lines. **REQUIRED:**
  `triaging-issues`.
- **Human steps.** Put a step only a person can take in its own issue, labelled
  `blocked: external`.
- **Platform skills.** When the phase introduces a platform area, add an item for the
  project skill that records this project's own decisions. **BACKGROUND:**
  `authoring-skills`.
- Show the owner the proposed list before creating anything.
- Once the owner approves, create the issues with the phase's `phase: N` label and link
  each one to its phase parent as a sub-issue
  ([tracker-commands.md](references/tracker-commands.md)).
- A follow-up filed while shipping carries no phase label. When the status query shows
  one under a parent, or an open issue sits outside every phase without `improvement`,
  place it: link and label together. **BACKGROUND:** `triaging-issues`.

## Improvements from daily use

When the owner asks for a small change after using the app:

1. **Classify it.**
   - **An improvement** stays inside the existing design: a key binding, a default, a
     tuning value, copy, a layout within `designing-ui`'s lock, a small change to how an
     existing screen behaves.
   - **Phase work** needs AWS or `infra/`, touches an ADR decision (a boundary, a
     persistence shape, the API contract, a provider, the security model), or overlaps a
     later phase's scope. Take it through "When the plan changes" instead.
   - A change against the design lock goes to `designing-ui` first. When the call is
     close, say which way it leans and why, and ask.
2. **File it without asking.** The owner's request authorizes creating the issue, and
   nothing more. Label it `improvement`, a type and a priority (`priority: P2` by
   default); give it no `phase:` label and no parent. Its body names what else reads the
   thing it changes — a tuning value in `packages/domain` is also read by the API.
   **REQUIRED:** `triaging-issues`. Several requests in one message get one issue each,
   unless they are one pull request's worth.
3. **Report the numbers and stop.** Shipping waits for the owner's pick, as in "Handing
   off to `shipping-issues`".

The lane has no exit criteria and never gates a phase. An improvement that turns out to
need an ADR or AWS loses the label and is placed in a phase, link and label together.

## Talking with the owner

- **Language.** Answer in the language the owner writes in.
- **Plain terms.** Gloss a platform term the first time it appears; the owner is not a
  cloud specialist.
- **Recommendation first.** Lead with the recommendation and its reason; alternatives
  come after.
- **Explain in the chat itself.** Put the explanation in the chat message, not only
  inside a question dialog. A dialog can hide the text written before it, and the owner
  has asked for the reasoning to be visible in the chat.
- **Settled questions stay settled.** Cite the roadmap or the ADR for anything already
  decided instead of asking again.
- **Scope of an OK.** An OK covers exactly the writes it was asked for. It does not
  carry over to the next change.
