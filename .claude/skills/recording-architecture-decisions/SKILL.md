---
name: recording-architecture-decisions
description: >
  Covers the architecture record under docs/architecture/: the vision, current-state,
  roadmap and references pages and the numbered ADRs under docs/architecture/adr/. Use
  when a change moves a context boundary, a persistence shape, the HTTP API or a
  client's contract, a provider or AWS service choice, or the security model; when
  proposing, accepting or superseding an ADR; when a roadmap phase lands; when writing a
  price, a limit or an AWS fact into a document; or when deciding whether a change owes
  an ADR at all.
---

# Recording Architecture Decisions

**Owns:** `docs/architecture/` — whether a change owes an ADR or a status change, the
ADR's shape and statuses, keeping the living pages true as work lands, and how a fact is
written into any of them. **Does not own:** which other surface a change lands on
(`updating-docs`); how a skill is written (`authoring-skills`); what is worked on next
and the phase issues (`steering-the-roadmap`); the decisions themselves — those are the
ADRs.

## What the tree is for

- `README.md` is the index and reading order, with one row per ADR and its status.
- `vision.md` says where the product and the system are going and which principles
  decide between options; `current-state.md` assesses the code at a named commit;
  `roadmap.md` holds the phases and their exit criteria; `references.md` lists every
  external source and every claim still unverified.
- `adr/NNNN-<slug>.md` records one decision each.

The architecture is being rewritten, so the ADRs describe the target and the code
describes what runs. When the two disagree, neither is quietly "fixed" to match the
other: the next change moves the code toward the ADR, or a new ADR changes the target.

## When a change owes an ADR

A decision owes one when it is expensive to reverse or someone outside the change will
build on it:

- a context boundary, or which context owns a piece of data;
- a persistence shape — a key layout, what is a log and what is a projection, what one
  commit may touch;
- an external contract — the API's resources, versioning, error vocabulary, the auth
  flow a client implements, the offline-sync semantics;
- a provider, AWS service or load-bearing library (the HTTP framework, the scheduler
  implementation, a payment provider);
- who may act for whom — the tenancy and security model;
- the cost structure — a component with a minimum fee, a new billed dependency.

A refactor inside a module, a test, a rename that crosses no boundary, a screen within
the design lock, or a fix that restores what an ADR already says owes none. Saying so in
the pull request is a legitimate outcome, not a skipped step. The test to apply: if a
reviewer a year from now would ask "why is it like this?" and the code cannot answer,
the answer belongs in an ADR.

## Shape and statuses

- Name the file `adr/NNNN-<kebab-title>.md` with the next free number; a number is never
  reused, even for a rejected proposal.
- Copy the section order of an existing ADR rather than rebuilding it from memory:
  Status, Date, Deciders; Context, Decision drivers, Considered options, Decision,
  Consequences (positive, negative, follow-ups), Open questions, Sources, Related.
- Statuses run **Proposed** (recommended, awaiting the owner) → **Accepted** (the owner
  confirmed it) → **Superseded by ADR-NNNN**. A partly settled decision says which part
  is which ("Accepted: DynamoDB. Proposed: the key layout.").
- Only the owner accepts. An agent writes Proposed and names what acceptance needs.
- When the owner changes an Accepted decision midway, rewrite the ADR in place so it
  states the current decision, and bring the roadmap and the issues into line in the
  same sitting. This is the owner's standing choice: one page that is true beats a chain
  of pages to reconcile, and git history keeps the earlier text. The status line gains
  `amended YYYY-MM-DD (<what>)`, and the new text gives the reason, so a reader still
  sees what changed and why.
- A new ADR supersedes an old one only when the decision is replaced whole — a different
  provider, a reversed direction — so that rewriting would leave nothing of the old
  decision; the old file then changes only its status line and gains a link forward. A
  typo, a dead link or a re-dated price is an editorial fix, made in place with no
  status change.
- Update `README.md`'s ADR table in the same change as the ADR.

## Keeping the living pages true

- `current-state.md` names the commit it was assessed against. When a phase lands and a
  finding no longer holds, rewrite or delete it and move the commit forward — a stale
  finding is worse than none, because it gets cited.
- `roadmap.md`'s exit criteria stay checkable: a command, a test, a deployed endpoint,
  never "works". Scope that moves between phases is moved, not left in both.
- A `path:line` rots with the next edit. Cite it with the commit it is valid at, or cite
  the symbol instead.
- `references.md` carries every external URL cited anywhere in the tree once, with what
  it supports and the date it was checked. Its Unverified list shrinks only by verifying
  an item (and citing it) or by deleting the claim that needed it.

## Fact discipline

Keep three kinds of statement apart, in every file of the tree:

- **Verified fact** — a primary-source URL and "checked YYYY-MM-DD". Check an AWS fact
  with the AWS documentation tools (documentation search and read, regional
  availability), a library fact with the library's own documentation — never from
  memory.
- **Decision or recommendation** — its reason and the alternatives it beat.
- **Unverified** — prefixed `Unverified:` and listed in `references.md`. Never fill a
  gap from memory to complete a table.

A price carries its unit, region and date, and one taken from a blog post or another
region is labelled as such rather than presented as the price here. Service availability
and GA status move; date them too. These pages will be read by people judging the
design, and one confidently wrong number costs the credibility of every correct one
beside it.

## Public-repository hygiene

The repository is public. Nothing in the tree carries an AWS account ID or an ARN
containing one, a user pool or app client ID, an unannounced domain, a secret, a
personal name or email, or any learner's data. Call the person who decides "the owner",
and name a resource by its role (the dev user pool), not its identifier. The secret
rules themselves are AGENTS.md's "Security and human approval"; this is their
application to prose.

## Writing

English, per AGENTS.md's Conventions. Spend words on trade-offs and on what the code
cannot say; do not restate it. Keep sketches small enough to check by eye — a type, a
key layout, an endpoint list — because nothing compiles a fenced block. Prettier and
`typos` cover this tree; run `pnpm fix` before committing. **BACKGROUND:**
`updating-docs`, whose "What belongs in prose" applies here unchanged.
