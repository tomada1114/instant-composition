# Composition screen projections and completion history

Home and records perform point reads and one fixed calendar range. They never call
`items` or traverse `compositionItemsPage`; GET neither rebuilds nor writes. An absent,
stale or migrating projection answers `ERR_READ_MODEL_NOT_READY`, served as temporary
readiness by the HTTP edge. The independent read-model worker prepares the current and
next practice day, using the profile's time zone and boundary hour.

`READMODEL#COMPOSITION#SOURCE` carries a schema and epoch. Every composition item,
settings, stats, tally or portion mutation advances this source in the same conditional
transaction. Source changes during maintenance reject publication; a later step
restarts. Catalog identity and the versions of settings, stats, the day's portion and
tally are also part of activation identity. A changed catalog withdraws the old
projection until maintenance publishes the new one.

The trusted bootstrap coordinator calls `compositionReadModelsValidity` for the current
and next day. It checks actual published rows, compact stats and all activation
versions, then rechecks the source and catalog identity. This performs bounded point
reads and no writes. The coordinator combines composition and vocabulary validity,
retains the minimum expiry, and verifies the learner registry before cutover; an
incomplete legacy learner remains in explicit maintenance readiness.

`READMODEL#COMPOSITION#<day>#BUILD` checkpoints two passes, each reading at most ten
strongly consistent progress rows. The first counts reach, pending reach, weakness,
answered quotas, due reviews and cards not due. Mastery resolves the current placement,
then a tombstone, then the stored placement; retired items retain their totals. Weakness
uses shown cards alone. Catalog membership is a fixed catalog-order bit string, without
FSRS schedules; retired progress never enlarges it. Evidence and first-rank aggregates
are bounded by the current catalog's concepts and subtopics, and the top-up candidate
list contains at most five entries. The second pass computes the first rank of each weak
concept in the due and not-due orders. This supports an arbitrary existing portion size
and unlimited reviews without storing candidate schedules in the checkpoint.

A live candidate row under
`READMODEL#COMPOSITION#<day>#<generation>#CANDIDATE#<due|notDue>#<order>#<id>` holds
schema 1, day, generation, mode, order, id, scheduled, recall, at and optional
expiresAt. It represents one eligible shown item, independent of grammar-tag count. Due
order preserves scheduled-first, FSRS recall, answer time and canonical card id; not-due
order preserves recall then id. Generation namespaces keep partial builds away from
active reads. BUILD, STATE and candidate rows mirror expiresAt at table level and expire
three days after preparation; runtime readiness rejects an expired STATE before eventual
TTL removal. Source and streak migration/intervals stay durable.

Ordinary answers replace the two affected source items and their current/next candidate
keys in the same source/model CAS transaction. Fixed finite quotas query only the
candidate head plus affected ids and recompute the small exact preview. Counts, catalog
membership and evidence are updated by subtracting old items and adding replacements. A
prepared answer followed by home or records therefore needs no maintenance traversal.
Settings/catalog changes and missing or expired generations use the independent worker.
The explicit unlimited composition setting may traverse candidate pages on a mutation;
its existing start/finish full-state reads are outside this query change.

A composition source transaction changes at most two items. Two adopted answers name at
most eight ordinary writes, one epoch, eight old/new current/next candidate actions and
four BUILD/STATE writes: 21 actions. Retry item expectations replace item writes. A
ten-item builder page names at most ten candidates, BUILD, STATE and the source
expectation: 13. The supported two grammar tags per card add fields, not actions.
Completion joins at most two streak neighbours alongside compact totals and the four
model rows; it never adds historical date arrays. Adapter transaction limits remain 100
actions and DynamoDB payload/item limits apply.

Maintenance uses the pure seeded fresh-card picker over catalog metadata and membership.
It preserves focus, weak and level shares, review retrievability order, legacy review
ties, new-card spreading, today's consumed quotas and top-up order. It publishes only
small preview and records aggregates at `READMODEL#COMPOSITION#<day>#STATE`. A screen
reads no build checkpoint or membership string.

## Exact streaks and calendar pages

New `STATS` writes contain `streak: { schema: 1, longest }` and omit `completedDays`.
Maximal completed-day intervals live under `STREAK#<start>`, each with schema, start and
end. Completing a credit day reads its immediate predecessor and successor by strongly
consistent primary-key ranges with limit one. The transaction joins adjacent intervals,
deletes the replaced right interval when necessary, and updates the longest run under
the stats version. Duplicate or arbitrarily late credits remain exact without copying
history. Three-day status reads also use a fixed number of interval lookups; week and
calendar dots use portions, including yesterday's recoverable gap.

`portionsPage({ from, to, limit, cursor })` performs one strongly consistent primary
`PORTION` range with a limit of at most 100. Its opaque cursor is scoped to the bound
learner and exact range, and cannot cross either. The records screen requests its fixed
twelve-week window in one page; callers may page older months separately. A cursor may
lead to an empty final page when the underlying store cannot prove the range ended at
the preceding limit. Other record families never enter the range.

## Existing learners

Legacy stats remain readable for explicit maintenance, while screen and composition
command readiness waits. `READMODEL#STREAK#MIGRATION` stores only a numeric legacy
cursor, a portion-page cursor, one open interval, the longest count and the stats
version. The first phase checks at most forty legacy credit dates and backfills a
missing historical portion without inventing answer counts. A historical credit has
target and progress zero, completion time zero and the `legacy-migration` marker.
Existing portions remain unchanged. The second phase scans portions forty at a time and
writes closed intervals. Only the final conditional commit activates compact stats and
removes the checkpoint. All source and evidence remain available after a failed step;
maintenance resumes from the saved checkpoint. If the legacy stats version changes
during migration, maintenance first removes one partial interval per step using the same
fixed predecessor/successor read. It then restarts the legacy cursor and portion pass
against the new stats version. No stale checkpoint permanently blocks a learner.
