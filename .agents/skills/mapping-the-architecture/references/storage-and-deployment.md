# Storage and deployment

## Persistence

Every table row has a `schemaVersion` independent of optimistic `version`. The adapter's
`storage-schema.ts` owns runtime decoders and the supported family inventory; identity
mappings follow the same contract. The initial guarded release admits the fourteen
baseline families only, reads legacy version 0 and guarded version 1, and emits
version 1. Projection/claim/compact-session families are reserved until their own
release adds them and raises the global envelope cap. Missing `schemaVersion` means
legacy storage. Legacy reads retain Leitner history, optional FSRS, old settings
defaults and supported talk/session values. Only explicitly named retired typed-answer
paths are removed after validating their historical shape. Every other unknown legacy
field, nested field or envelope key fails closed; reads never rewrite the table.
Optional transport keys are PK/SK and a valid matching expiry. Guarded rows validate
nested values strictly; an unknown schema or undeclared field fails closed. Writes
validate the current value, strip only named retired paths, and condition updates,
expectations and deletions on both the optimistic version and a supported storage
schema. Whole-row changes first strongly read and decode their source, so direct commits
cannot erase an unknown unversioned field by skipping a prior application read. Domain
types retain their pure data shape and import no schema library.

The schema 3 contract admits durable model tasks alongside the schema 2 round adoption
checkpoint. A task declares schema 3; absent or earlier envelopes cannot certify that
family. Results and failures omit the lease; in-flight tasks require one, including
zero. Canonical learner/task keys bind the nested identity, and the top-level TTL must
match its expiry. Every declared historical envelope keeps its own strict shape.

The round adoption checkpoint's first-card ids, log cursor and completion flag survive
legacy initialization and later writes. The current checkpoint fixtures retain the
archived initial-guard fixture unchanged, and the old writer certificate cannot
authorize a rollback after the checkpoint schema is emitted.

`storage-release-policy.json` is the reviewed expand/contract ledger. Its emitted schema
inventory only grows: reverting code does not revert data. Fixture and implementation
hashes bind the certified read/write bounds to the complete
domain/application/adapter/API writer implementation, rather than only its decoder. The
reviewed inventory must exactly match every actual runtime TypeScript module in those
trees and their manifests/root package/lockfile: missing, duplicate, new unlisted
modules and symlinked inputs refuse certification.
`node scripts/storage-release.mjs current` executes the compatibility fixtures before
AWS credentials or deployment; `storageReleaseMetadata` records the contract and
implementation fingerprint in each writer bundle's immutable storage release manifest,
and `assertStorageArtifact` refuses missing or different writer evidence. The initial
supported range contains only artifacts of the guarded storage contract. Earlier
unguarded APIs have no certification and are refused. A code fix whose storage
implementation is identical can use that contract and safely roll back between its
certified artifacts. The dev pipeline still deploys only current trusted main: perform
an operational rollback with a new main revert commit carrying that certified writer,
then run the same paused transition. It does not dispatch an arbitrary historical SHA. A
changed writer requires new lossless next-write fixtures and explicit ledger
certification. Deployment selects the ledger's current contract and its declared
`writes` schema; fixtures must agree with that contract/schema and the runtime validator
must actually emit it. Every later shape release raises the adapter cap, expands the
admitted inventory, preserves historical emitted schema bounds, and updates the exact
source inventory and fixture certificate before deployment. The released legacy-to-v1
migration stays explicitly fixed to that tested plan. The operator must select
`--plan expand-to-storage-v2` for the reviewed legacy/v1-to-checkpoint-schema expansion;
its distinct checkpoint identity prevents resuming a v1 plan against a different target.
The reviewed `--plan expand-to-storage-v3` explicitly admits schema 0, 1 and 2 rows and
targets storage-v3/schema 3 with its own checkpoint identity. It validates already-v3
rows without rewriting them and preserves top-level TTL presence on expanded rows
without renewing expiry. The default v1 and explicit v2 plans stay fixed; a newer
trusted writer refuses them before opening a child or checkpoint. Later noncompatible
plans require their own transformation/decoder rather than retargeting a plan
automatically; a reader-only fixture is insufficient.

The first guarded transition drains the unguarded API before any expanded writes. The
dev workflow synthesizes a paused assembly, updates exact owned ARN permissions in two
phases, keeps every old/new Lambda at zero through code/configuration updates, then
verifies installed ZIP bytes and guard metadata before restoring capacity. Controlled
concurrency changes carry fresh revision receipts and a complete configuration digest;
later observations must match exactly, including a final all-writer capacity check.
Cleanup closes every known owned writer before considering certified predecessor
recovery. `node scripts/storage-transition.mjs verify <assembly> <sha>` runs before
OIDC; `deploy <assembly> <sha> <deploy-role-arn> tomada1114/instant-composition`
performs the authorized transition. Failed preguard/partial rollouts remain paused for a
compatible forward fix. `writing-infrastructure` owns the admission, timeout, recovery
and intended capacity drift details.

Deploy the guarded baseline before any persistence expansion. Each later shape change
raises the global envelope version, adds explicit runtime fixtures and updates the
ledger. An older guarded binary refuses the higher version on read, update and delete,
including new round checkpoints and compact Stats. A known future field mislabeled as
version 1 is rejected as well. Only fixture-certified writers that preserve the emitted
shape can coexist or roll back. Drain incompatible writers before enabling new writes;
contract only after a migration is verified and rollback bounds are narrowed. Unknown or
unsafe artifacts are rejected before deployment or writes. Recovery uses a compatible
forward fix; no read-only API mode or automatic down-migration is provided. Run rollback
preflight from the trusted current guard against the selected immutable artifact, never
an old checkout's policy. Never deploy a preguard workflow directly to bypass this
check.

The future read-model release adds a separate system bootstrap checkpoint at
`SYSTEM#READMODEL / BOOTSTRAP`, guarded by the same envelope cap and optimistic CAS. Its
strict value binds trusted release SHA/contract/fingerprint, catalog, opaque bounded
position, phase, practice-day validity and diagnostic maintenance version. The initial
cap1 release cannot read or write this family. The worker coordinator owns durable
resume: null loads saved progress in a fresh CI job, each verification page checks
current learner source/profile/model identities, and a completed cache starts fresh
verification. No global source epoch is invented and maintenance version alone is no
readiness proof.

`node scripts/storage-migrate.mjs --table <dev-table> --profile <operator-profile> --checkpoint <private-path>.json --dry-run`
pages through the table with the same runtime decoders used by API reads. The explicit
maintenance subprocess is an operator program, not an HTTP endpoint or a second
deployable, and learner bodies travel only on its private stdin/stdout. A loopback
`--endpoint` instead of a profile confines a run to DynamoDB local. Dry-run performs no
data, checkpoint or lock-file writes. Apply requires `--apply --writers-stopped`; stop
every API/maintenance writer and pause TTL expiry for a stable inventory before a
noncompatible migration. Take the verified backup first. The released plan normalizes
legacy rows into the guarded contract; a future noncompatible plan must supply its own
tested transformation and target decoder before registration.

A checkpoint names the migration and exact table/endpoint, cursor, pending keys/digests
and counters; it contains no learner values. Pending pages are checkpointed before any
write. Each replacement is conditional on the read optimistic/schema versions, and the
optimistic version advances once. `--resume` recognizes a completed replacement whose
acknowledgement was interrupted by matching its digest and exact resulting version. A
competing update fails closed. Page boundaries survive interruption even when all rows
were already current, and completion/replay verifies target decoders and the total
count. `--max-pages` bounds an operator run. Keep the checkpoint after any refusal;
inspect the conflict and deploy a compatible forward fix before resuming, never silently
restart a partially applied noncompatible transformation.

- One DynamoDB table, on-demand, one partition per learner, with TTL on `expiresAt`
  (epoch seconds) for records that should lapse, such as an abandoned talk. The key
  shapes are `packages/adapters/src/keys.ts`'s; the map today:

```text
LEARNER#<id>  PROFILE | SETTINGS | STATS            single records
LEARNER#<id>  ROUND#<round>                         a round
LEARNER#<id>  ROUND#<round>#ANSWER#<answer>         the review log, append-only
LEARNER#<id>  PORTION#<day> | DAY#<day>             a day's portion and tally
LEARNER#<id>  ITEM#<kind>#<item>                    an item's projection: composition or vocab
LEARNER#<id>  VOCAB#<session>                       a vocabulary session
LEARNER#<id>  VOCAB#<session>#ANSWER#<answer>       its answers, append-only
LEARNER#<id>  TALK#<talk>                           a talk with its turns and candidates; expiresAt until kept
LEARNER#<id>  MODEL_TASK#<talk>#<task>#<turn>#<version>[#<startedAt>]  a leased model claim, result or failure; expiresAt
LEARNER#<id>  CARD#<card>                           a personal vocabulary card, made from a talk
IDENTITY#<sub> LEARNER                              the identity mapping
```

- A talk is written with `expiresAt` beside its value while it is open or discarded, and
  without it once finished or ended, so only a talk never kept lapses. TTL deletes late,
  so the commands read a talk past its `expiresAt` as absent.
- Before any talk model call, the learner-bound store conditionally reserves its
  semantic task key (talk, task, turn, prompt version and the stored talk start time for
  turn/candidates work). A turn reserves teacher and partner together against the talk
  version. Saved results recover a crash before the talk commit; claim versions and
  server-made tokens fence both expired-claim reclamation and late executors, including
  deletion and recreation at the same optimistic version. Task recovery data expires
  after a day, independently of the kept talk, whose own results remain. An active claim
  returns temporary model unavailability; changed input under that key is a conflict. A
  new endpoint invocation retries a failed or expired claim. Unknown provider outcomes
  can bill twice on retry without provider idempotency; per-attempt logs mark that
  possibility. The shared gateway throughput policy remains separate.
- Every id in a key is escaped with `encodeURIComponent`, so none reaches across a `#`.
  A round and its answers are one prefix `Query`, as are a vocabulary session and its
  answers, and each kind of item; there is no secondary index.
- Each command commits as one `TransactWriteItems`, puts conditioned on absence and
  updates and deletes on the version read — deleting a personal card with its progress
  is the one delete, and no commit updates or deletes a log entry; projections change in
  the same commit that appends to the log. Answer writes point-read only requested
  answer ids, progress and personal cards, version-checking unchanged progress too.
  First-answer adoption is a bounded `round.answerState` projection guarded by the round
  version. Old open rounds initialize it separately, reading at most 32 reviews per page
  and committing each cursor and card set before continuing; failures resume the
  checkpoint without recording new answers. That one-time cost follows the legacy log
  size; subsequent answer reads follow only requested keys. A vocabulary answer checks
  each personal card's version in that transaction and reloads its snapshot on conflict;
  deletion checks progress's version or continued absence. Deleted personal cards are
  skipped on a fresh answer load, while existing answer logs remain. Vocabulary answers
  use chunks of 32 so even a personal-card check per answer stays under the transaction
  limit. Answers commit per batch rather than all at `finish`, because one transaction
  holds at most `MAX_COMMIT_ITEMS` (`keys.ts`) actions and a long round with resends
  would not fit. The in-memory store and DynamoDB local run the same contract suite.
  **REQUIRED:** `designing-application-core` for the commit shape.
- Existing records remain readable. A field a record gains is optional and read with its
  default when absent; a field a type drops stays in old items, and both stores read
  settings, rounds, review details, item progress, talks and personal cards through the
  fields their types declare (`packages/adapters/src/declared.ts`), so it is neither
  returned nor written back.
