# Continuous paged vocabulary sessions

The browser uses additive `/v1/vocab/paged-sessions` operations. Start creates or
resumes one learner-bound logical ID, returning a small `building`/`ready` descriptor.
Each explicit POST `/{sessionId}/prepare` copies at most 64 global queue positions to an
immutable page. The browser repeats this bounded operation before study; navigating away
stops after the in-flight request, and reload resumes the saved ID/checkpoint. Page
reads never build a read model or rebuild a session.

Preparation selects against the independently prepared primary read model from
`read-models.md`. The session fixes day, kind, category and start identity. Source
epoch, prepared model version, settings, stats and catalog identity are CAS
dependencies. A change before readiness restarts preparation under a new generation,
preserving the logical ID and original practice day; missing matching prepared models
yields `ERR_READ_MODEL_NOT_READY` until independent maintenance completes. Abandoned
pages remain stored. Once ready, source changes caused by ordinary answers do not alter
membership or require a live candidate scan.

Due/fresh interleaving follows the global queue positions. Category filtering happens
after selection, preserving shared daily quotas. Finite today, extra and weak sessions
retain their bounded selection rules. Pages may be empty after category filtering or
withdrawal, and their EOF does not finish the logical session. Frozen membership and
new-card flags live in immutable pages; current text/intervals are loaded only for each
bounded page. A withdrawn catalog ID or deleted personal card is omitted; additions
never enter an already ready deck. Reload requests additionally name at most 16 active
retry/current-card references, whose immutable membership is checked and whose current
views are reloaded, so cached checkpoints cannot revive withdrawn cards.

The API returns at most 64 current card views and 16 retained views, each JSON view at
most 4096 characters. Stable continuation is `<generation>:<page>` and is checked
against the authenticated learner's session. A failed request retries the same
continuation. The client retains only the current page, current card and active re-asks,
pruning old card bodies/tallies and keeping one latest answer in its reducer. A bounded
checkpoint preserves global step, retry due order, per-card retry counts and original
page/slot answer identity across reload. Fetching another page does not advance the
study step, accelerate waiting retries, show a result, or add a continue button.
Existing four/eight/twelve-card gaps and 10-retry caps apply to the logical session.
Only EOF plus exhausted firsts and re-asks triggers finish.

Storage uses four learner-partition families without TTL. Shared commit validation and
read decoding enforce every declared bound, including the valid ISO day, 256-character
catalog identity and 4096-character candidate cursor. Historical JSON primary-key
cursors and canonical markers retain their exact stored bytes; consuming either form
checks the learner, original day and captured due-candidate generation. Unknown fields
or foreign ranges fail before any mutation:

| Family              | Sort key                                        | Bound and purpose                                                                                                               |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `vocabPagedSession` | `VOCAB_PAGED#<encoded id>`                      | Small preparation/end guard, aggregates and first 32 again snapshots; preparation-only fresh IDs <=200 are cleared at readiness |
| `vocabDeckPage`     | `VOCAB_PAGED#<encoded id>#GEN#<n>#DECK#<p>`     | Append-only <=64 IDs and original new-card flags                                                                                |
| `vocabPageProgress` | `VOCAB_PAGED#<encoded id>#GEN#<n>#PROGRESS#<p>` | <=64 adopted first IDs                                                                                                          |
| `vocabSessionGuard` | `VOCAB#<encoded id>#GUARD`                      | Small end guard for existing finite sessions                                                                                    |

Every paged answer carries its immutable page membership. A maximum 60-input HTTP batch
is validated before its first mutation and committed in chunks of 2, reserving
transaction actions for both prepared-day candidate/model updates. Progress, review,
item movement and small guard are atomic. Resent IDs write nothing, including after
close; fresh IDs after close are refused. Neither paged nor legacy answer Put contains
an immutable full deck. Legacy answers ConditionCheck the old session and update its
small guard; legacy finish atomically closes both. Paged finish reads aggregate counts
and a bounded again preview, never a full review log; `againCount` reports the whole
count.

The browser persists unsent answers in localStorage `vocab-outbox:<sessionId>` using
scalar head/tail/count/offset counters and deterministic `:page:<n>` records of at most
20 answers. Only the head, append page and a bounded recent acknowledgement receipt are
loaded; there is no growing answer/key/index array or offline backlog cap. A shared
origin Web Lock serializes every durable mutation across independent documents. A small
`:owner` UUID is adopted under that lock after validating an old six-field metadata/page
record; adoption preserves original pending/recent answer identities. Unknown owners and
unreadable records are held. Every instance captures that owner, including an idle
instance created before another document finishes. Unsupported Web Locks or storage
refusal fails closed on new writes and preserves existing bytes. Page bytes are saved
before metadata; recovery checks only the head and current/next tail pages. Head/offset
comparison makes repeated acknowledgements safe. Retry deadlines and conflicts retain
the pending head, and all network bodies contain at most 20 answers.

A grade is durably appended before the compact checkpoint and visible feedback advance.
A failed metadata/checkpoint write keeps the original grade for the next save attempt;
only one grade and one deferred control event are retained. The most recent bounded
acknowledgement receipt repairs a crash after acknowledgement but before checkpoint.
Stop or failed continuation preserves both. Finish waits for all durable answers before
closing with an empty batch. After successful close acknowledgement, cleanup reacquires
the storage lock, verifies the owner and an empty queue, validates known session record
suffixes, and removes its metadata, recent receipt, pages, removal markers and
active/checkpoint pointers. The owner is removed last so older instances cannot recreate
the queue. Concurrent pending appends or unknown/corrupt records prevent cleanup and
remain available for retry. Prefix matching preserves other session ids. Acknowledged
pages are removed as they drain. Existing finite queues/endpoints remain replayable.

Only a submitted native logout navigation or a confirmed terminal authentication refusal
clears all sessions' `vocab-outbox:` pages, receipts and removal markers and
sessionStorage `vocab-active:`/`vocab-checkpoint:` pointers. Ordinary visits, reloads
and temporary network/renewal failures preserve them. The storage lock is acquired
before native submission, and successful submission plus synchronous invalidation run in
the same turn. An origin storage revision invalidates stale outbox instances and other
documents' private checkpoints, preventing late sends or cached state from recreating
learner data. The epoch is initialized persistently before sharing; unavailable
persistence never produces a reusable default epoch. Failed replacement falls back to
epoch removal, and private cleanup is attempted independently of epoch persistence.
Unrelated browser settings and the authentication cookie-renewal hint are retained.

Compatibility remains available indefinitely: original `/v1/vocab/sessions` delivers
whole decks of at most 200 cards. An unlimited global today allocation greater than 200,
or requesting a whole-deck reload of an older session whose deck exceeds 200, returns
409 `ERR_PAGED_SESSION_REQUIRED`, including category starts whose selection would
require traversing that global unlimited deck. It never silently truncates a deck for
clients that interpret response EOF as completion. Existing saved sessions of any deck
size, including 257-card legacy sessions, retain answer/resend/finish recovery
indefinitely. Only new whole-deck starts and reloads have the 200-card response bound.
Existing finite payloads are preserved. The additive paths and error appear in OpenAPI
and the generated client, and the frozen old-client compatibility fixture must assert
this intentional boundary before release.

Activate these families only after the storage guard's paused deployment drain. The
parent integration emits envelope schemaVersion 5 and registers all four families; no
old writer certification is implied. The separate immutable `expand-to-storage-v5`
operator plan accepts source envelopes0..4, validates current5 rows without rewriting
them, and preserves exact top-level TTL presence. Prior plans remain tied to their
archived certificate and refuse the current writer. Backups/restores include every
family and abandoned generation, validate key/value identity, page membership, progress
subsets and closed legacy guards, and preserve raw AttributeValue contents. Focused
source checks cover domain positions, maximum due fixtures, API
continuation/compatibility, compact client retries and DOM stop/reload/lost-response
behavior. The same persisted membership/replay contract runs in memory and actual
DynamoDB Local, with serialized wire requests checked against 100 actions, 4 MiB and 400
KiB limits.
