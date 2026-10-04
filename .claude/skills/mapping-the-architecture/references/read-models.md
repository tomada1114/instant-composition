# Bounded vocabulary read models

Vocabulary screen reads use a small day model and bounded primary-key candidate pages.
They never enumerate progress, personal cards, review history, or maintenance pages.
Counts and candidates are separate ports: an unlimited review setting still returns
bounded hub counts, while the explicitly unlimited session traverses candidate pages.
The displayed review limits (50, 100, 200), new limit (at most 30), extra session (10),
and weak session (20) retain the pure domain plan's ordering and category allocation.
Plain new cards use ascending and descending level buckets, with category interlacing
performed over bounded candidates. Personal levels absent from the catalog are included.
Due and weak keys preserve the binary64 FSRS recall comparison and original card order.

## Storage and consistency

The learner-bound families are `readModelSource` (`READMODEL#SOURCE`), `vocabReadModel`
(`READMODEL#VOCAB#<day>#STATE`), `vocabCandidate`
(`READMODEL#VOCAB#<day>#<generation>#<mode>#<category>#all#<order>#<card>`), and
`vocabReadModelRequest` (`READMODEL#VOCAB_REQUEST#<day>`). IDs, days, and namespaces are
escaped. The state holds four category records with scalar counts; candidate ids live in
individual rows. Modes are due, weak, fresh, freshLower, freshWeak. Every family carries
schema 1; unknown schema or malformed bounded state fails decoding. Queries use strongly
consistent primary GetItem/Query, never an eventual secondary index.

A raw card or vocabulary-progress commit increments the source epoch in the same
transaction. Application commands also update both prepared days' affected counts and
candidate rows in that transaction, guarded by source and row versions. Ordinary
answers, personal-card additions/deletions, settings changes, and level changes do not
run a full rebuild. Settings and level are query inputs; reads/starts guard their
versions. Direct source writes, catalog changes, or missing generations invalidate
readiness until maintenance prepares a matching source/catalog generation. Activation
checks the source epoch atomically; a source race restarts a distinct namespace without
exposing a partial build.

Generated state/candidate rows retain optional expiresAt in value and as the table TTL
attribute. New generations expire three days after preparation, including requested past
days. Runtime readiness rejects expired state before TTL deletion, whose timing is
eventual. Source, requests, registry, and system checkpoint are durable. Abandoned
namespaces expire.

## The independent driver

`rebuildVocabReadModel` advances one page of ten catalog or personal cards and returns
building, ready, or restarted with the rows handled. `advanceReadModelMaintenance`
persists one bounded system checkpoint, `SYSTEM#READMODEL / CHECKPOINT`, with up to 100
trusted learner/profile records. Normal enumeration is a strongly consistent primary
registry Query, `SYSTEM#READMODEL_LEARNERS / <learner>`, page limit 100. Trusted
directory registration/profile writes update that registry atomically; a newly
registered learner is discoverable immediately. The worker re-reads the bound profile
before using its day. Legacy discovery is a separate explicit paged backfill, never a
normal worker Scan.

In AWS, EventBridge invokes the separate read-model Lambda every minute. One concurrent
invocation runs at most 100 checkpoint steps, with two retries and five-minute event
age. Locally, `pnpm api` advances the same worker independently every second. Neither
driver runs in an HTTP handler. The worker prepares the current practice day and the
next day using the learner's stored time zone and boundary. A late scheduler resumes its
checkpoint against the current day; failures preserve completed pages and retry without
double counts. Source changes during a build cause a guarded restart. Sustained writes
can delay an incomplete build; the ready current day remains incrementally maintained.

## Missing generations and old offline sessions

A missing, stale, building, or expired generation yields the existing envelope with
`ERR_READ_MODEL_NOT_READY`, HTTP 503 and Retry-After 2. Responses add no required field.
The new browser repeats only the bounded GET for at most 30 retries (about one minute),
then returns that typed error to its ordinary retry flow. It never advances rebuilding.
Old /v1 clients can use the same additive error envelope and Retry-After header.

Finishing an old offline session first accepts its bounded answer chunks, then requires
its original day's exact small model. If missing/stale, the finish POST places a durable
learner-bound requested-day row and returns 503 without closing the session. The worker
pages the separate request prefix, advances the first pending day, and removes a request
only with request/model/source version checks after readiness. Repeated finishes reuse
the request and recorded answers. Once prepared, finish derives tomorrow from scalar
counts and closes with source/model/settings CAS. Its original-day semantics require no
full scan inside finish or a subsequent GET.

## Cutover and recovery

Release the storage schema guard before writing these families. Keep the previous reader
release until explicit initial migration has backfilled the learner registry and
prepared ready models for the deployed catalog and current/next learner days. The
certified worker Lambda accepts the trusted operator event
`{ storageBootstrap: true, checkpoint: null | string }`; it accepts no learner id,
table, region, or catalog override. `runStoredReadModelBootstrap` dispatches one legacy
Scan page of 100, one worker budget of 100 steps, or one primary registry verification
page of 100. Its sanitized result carries complete, phase, checkpoint, rows, and
learners. Only complete true has phase verification and checkpoint null. An incomplete
result retains a bounded opaque checkpoint; unsupported checkpoints fail closed.
Verification requires both vocab and composition readiness, matching source/catalog
identities, compact stats, and drained requested-day queues. Catalog changes and a
previously verified learner crossing its practice-day boundary restart preparation.

A guarded worker also saves durable bootstrap state at `SYSTEM#READMODEL / BOOTSTRAP`,
family `readModelBootstrap`, schema 1, without TTL. It binds the trusted guard release
SHA/contract/schema fingerprint, catalog, bounded checkpoint, validity deadline and
maintenance checkpoint version. That last version is diagnostic; every verification page
still checks learner source/model/profile identity. A null checkpoint from a fresh CI
job resumes this worker-owned state. Caller cursors alone never permit skipping a page:
an absent durable row starts discovery, and an existing row takes precedence. A
completed row starts a fresh registry verification pass; it is never returned as a
cached certification. A changed trusted release starts discovery again. The immutable
guard supplies release identity through the handler's second context, never the event or
an environment override. The schema guard must activate the real global CAS adapter
before deploying this cutover; this source slice does not certify a legacy writer
rollback or activation by itself.

The storage transition keeps API concurrency zero, certifies every installed writer ZIP,
temporarily enables only that certified worker at one, and invokes these bounded
bootstrap steps. The deploy role uses Lambda invocation; it receives no learner-table
credentials. EventBridge work can interleave through the same source/checkpoint CAS.
Completion or failure pauses the worker again before the transition rechecks guards and
restores writer capacity. Failed or unknown outcomes preserve the checkpoint and keep
writers paused. Creating the worker resource alone does not prove preparation completed.

A catalog cutover follows the same preparation prerequisite with the new catalog
snapshot; old snapshots remain fail closed under new readers. If scheduling stops past
the prepared next day, screen reads remain unavailable until the repaired driver
prepares the current day. Check scheduler invocation/failure metrics and the durable
build/checkpoint; advance the independent worker, then verify matching ready
generations. Do not put corpus polling in a screen or repair readiness by relabeling an
incomplete state ready.

Backup restoration uses raw operator transport, separate from application source
commits, and verifies the whole restored inventory before activation. Recheck
model/source/catalog readiness after restoration; model caches can instead be rebuilt
with fixed pages. A writer release that does not preserve source epochs,
request/registry families, and schema checks is not a safe rollback after cutover. No
deploy or migration readiness is implied by local unit tests or synthesized
infrastructure.
