# Dreaming Worker ledger on Neon

## Plain mechanism

Session Search remains the evidence/search system. Dreaming Worker consumes bounded evidence, produces `DERIVED_ONLY` proposals, and stores only those derived records in its own Neon ledger.

```text
Session Search shards
      | bounded evidence + shard/generation provenance
      v
Dreaming Worker
      | validated proposal / supersession event
      v
existing Hyperdrive -> dreaming_issue23.dw_ledger
```

The ledger is not another Session Search shard and is not copied into the shard corpus.

Future ChatGPT access should use the Session Search surface without sharing database credentials:

```text
ChatGPT
  -> Session Search App/tool (future session_hypotheses)
  -> bounded Dreaming Worker ledger reader
  -> dw_ledger (read only)
```

This keeps source retrieval and model-derived hypotheses visibly separate while allowing one user-facing retrieval surface.

## Existing cloud boundary

The intended host is the already-created Dreaming Worker Neon project `theseus-ss-dreaming-issue23`, database `dreaming_issue23`. Mastra uses schema `dw_issue23`; the ledger gets its own `dw_ledger` schema.

The existing Hyperdrive/runtime role is reused for the Worker write path. Ledger grants are stricter than Mastra grants: `SELECT + INSERT` only. Session Search does not reuse that runtime credential.

## Not performed by this design

The checked-in SQL is not applied by this change. There is no automatic write path, no ledger reader endpoint, no Session Search tool change, and no production deployment.

## Durable work composition (laboratory)

The deterministic checkpoint identity is reserved through a unique PostgreSQL
insert before bounded analysis. The same existing ledger adapter validates and
inserts all derived records in a single transaction with completion and ordered
membership. A successful acknowledgement is not sufficient; readback validates
record identities and the durable projection digest. The in-memory analysis
hash is recorded, not represented as independently reconstructed raw output.
The reservation token correlates a writer, not a separate authorization system.
An incomplete or unresolved reservation remains blocked from repeat inference;
automatic takeover and source-level cursor progression are not implemented.
The caller receives the in-memory analysis and any uncommitted candidate
separately from independently verified completion; replay does not reconstruct
raw model output.
The real PostgreSQL contract exercises concurrency, replay, rollback, simulated
lost acknowledgement and corruption using synthetic inference adapters.

### Completion-only recovery

If both passes produced a valid candidate but durable completion could not
be verified, the trusted caller receives a recovery envelope with the
original reservation correlation and exact candidate. This envelope is
in-memory caller custody, not durable storage or proof of authority. Keep
it within the trusted execution boundary; do not emit it in public logs.
Explicit `recoverDurableCompletion` first validates and reads the result.
An exact match returns without writing; a failed or conflicting read blocks
recovery. Observed absence permits one completion transaction followed by
independent readback. No inference, new reservation or automatic takeover
occurs. A lost candidate or incomplete analysis still requires a separate
recovery policy; this is not crash recovery if the envelope itself is lost.

### Source-batch acknowledgement reference (issue #65)

A work completion is not a source checkpoint. A source refresh may require
several independent work items; a worker that crashes after the first
completed item must not advance the entire source checkpoint.

The disposable PostgreSQL contract now tests one append-only successor
record per scope and previous checkpoint, alongside the existing
`createPostgresWorkStore` and actual durable Pilot 2 composition. The
fixture roots its chain explicitly, reads every required work completion
using the existing validator, then inserts the successor. The unique
predecessor constraint and self-FK prevent forks and missing parents.
Readback independently binds the entire receipt to its fingerprint (sorted
object keys, not JSONB insertion order). Competing successors, incomplete work,
corrupt completion, restart, lost acknowledgement, scope isolation and
append-only grants are exercised. Empty work sets deliberately block in
this fixture; a production non-work disposition needs its own verified
source contract. All inference adapters are synthetic.

This is a reference in `qa/postgres/work-atomicity-probe.sql` and
`qa/postgres/work-atomicity-probe.mjs`, **not** a runtime migration.
The expected work list, scope and source digest are trusted fixture
inputs; the test does not authenticate them, prove exhaustive source
membership, verify actual generation readback, or store a reconstructible
Session Search membership receipt. The competing candidates are synthetic
storage contenders, not two independently validated source transitions.
Verification of immutable work completions precedes the checkpoint
insert; a production design must preserve that invariant and address
corruption/concurrent additions at the storage boundary. No claim that a
database constraint alone establishes evidence authority.

The next implementation can reuse the same database and existing
append-only work completion records. It needs the exact verified source
handoff and stable scoped work identities from Session Search, a
reconstructible predecessor receipt (not just its digest), explicit
no-work/removed-source disposition and independently verified checkpoint
readback. Bind analysis scope/version as well as accepted source and
serving provenance. Do not introduce a new queue or database unless
existing constraints prove insufficient. Do not deploy this fixture or
grant real source access.

### Recovery handoff decoder

The portable `decodeSourceHandoff` accepts the private Session Search
recovery candidate v1 (SS PR349) against a caller-owned expected provider,
scope, last completed membership snapshot and independently observed READY
catalog. It validates exact canonical digests, append-only membership,
ordered unique/disjoint selected and removed session IDs, and exact
generation/manifest placement. The checked-in synthetic fixture was
generated by the actual Python producer at e8df1058710d753a94c6c918852751a8b946778d.

This is wire validation, not source authentication or proof that the
candidate enumerates all changed conversations. The expected observation
must come from a trusted source, not the candidate itself. Unknown
currentness and removal obligations survive. No evidence bodies, inference,
source acknowledgement, runtime binding or storage mutation result from
decoding. The next stage must bind independently verified scoped evidence
to the existing work identities and completion receipts before any durable
source checkpoint can advance.

### Verified selected-session work (synthetic recovery adapter)

`prepareVerifiedSessionWork` composes the existing source handoff decoder
and durable Pilot2 input without introducing a new reader or model stage.
It verifies caller-acquired pages against the trusted selected metadata
from SS PR350: exact scope, accepted membership, manifest/generation,
session coverage/title, ordered message IDs/roles/classes/timestamps,
source membership, offsets, terminal page and reconstructed text SHA-256.
Explicit limits bound admitted pages, total codepoints and message count.
All searchable messages (including blank ones) are checked; no usable
text returns an explicit no-work candidate, not a source acknowledgement.
The model receives nonblank evidence with stable scoped message references.

The versioned JS-local content fingerprint includes session metadata and
ordered message metadata/digests, not archive links, generation or packet
ID. The Python content digest is preserved as opaque metadata, not
recomputed using JS numeric formatting. Exact lineage is returned separately
and is not yet persisted by the runtime completion adapter. The existing durable runner
continues to establish work identity and verify individual completion.
A changed generation or added archive link alone therefore does not
repeat inference for the same scoped content and analysis intent.

The recorded synthetic fixture uses SS commit
3b7b5360050cc2ecdcb60f485a657f2b763751e4, actual canonical ZIP packages
loaded into disposable PostgreSQL 16 with existing migrations, and existing
router/shard handlers backed by the reader-only SQL role. The prior PR341
parity bridge was reused with fixture shard pinning; two conversations,
12 pages, limit 2, max_chars 3. The fixture records the exact readback
rather than claiming live hosted Neon verification. Fixture reproduction
is not yet an automated cross-repository QA gate. The replay test changes
generation and adds a synthetic source link, and invokes the actual durable
runner with synthetic inference and an in-memory store; it is not a real
database commit test. PG-backed completion mechanics were separately
tested in PR72.

Trusted source index and handoff custody, catalog freshness and acquisition
limits/timeouts remain external preconditions. This adapter checks already
acquired pages, not a network transport, and opaque cursor bytes are not
authority. No private-data permission, external inference, source checkpoint
advance, new service or production migration. Empty/removed obligations
still require explicit source-level disposition. Persisted source lineage
and batch acknowledgement remain the next integration boundary.

### Integrated source-batch PostgreSQL reference (PR74, issue #65)

The existing disposable heavy-postgres probe also consumes the exact
recorded selected-session fixture through prepareVerifiedSessionWork.
It derives both work identities using the real checkpoint preparation,
runs durable Pilot2 against the actual PostgreSQL store with synthetic
inference, and reads every completion independently. Only the exact
selected set can produce the fixture acknowledgement; missing or
duplicate entries, unfinished work and unresolved removals cannot do so.

The existing fixture source_checkpoints table stores a successor receipt
with the full decoded handoff (including reconstructible membership),
analysis intent, work keys, verified completion digests and exact selected
source lineage. Its JS-local fingerprint covers the entire receipt using
sorted object keys. No transcript bodies are stored in this receipt.
The test checks all derived record references against the prepared
evidence, partial progress, fresh-store restart, lost acknowledgement
and exact readback; two work items require four synthetic inference
responses total and replay requires zero additional responses.

This test-only composition uses the prior recorded SS reader pages,
not a live cross-service network call. It does not implement a runtime
batch store, source authentication, safe handling of empty/removed work,
or a source checkpoint migration. Individual work can be committed
before a source receipt is published; durable pending-batch custody and
exact resume semantics still require implementation. The fixture itself
is restricted to the disposable dreaming_worker_contract database by
the existing probe schema. No new Neon allocation.

### Portable source-batch receipt builder

`prepareSourceBatchReceipt` derives the exact selected work set itself
from the trusted recovery candidate and bounded reader pages, rather than
accepting a caller-provided list of work keys. It validates all selected
inputs before reading completions, and rejects missing, duplicate, extra,
removed, blank-only or over-budget work. The caller owns trusted predecessor
and catalog observation. Missing completion returns PENDING; failed or
inconsistent readback returns STORAGE_UNKNOWN.

It independently validates completion identities, recomputes the original
request fingerprint with the stored original packet ID, and checks every
proposal reference against admitted evidence. A later equivalent source
witness is not represented as the original inference custody. The receipt
binds full handoff/membership, predecessor, task/version, exact work and
completion fingerprints, original packet identity and current witness.
The digest uses sorted keys in a versioned JS-local encoding. No message
bodies are stored in the receipt. No write or inference is performed.
Existing PostgreSQL QA reads actual durable completions through this
function. Pending batch custody, durable source store/chain enforcement
and no-work/removal disposition remain open; the predecessor key itself
must be verified by that store before any acknowledgement. No real intake
or source permissions are enabled.

### Source checkpoint storage adapter (issue #65)

The existing versioned ledger DDL now includes source_checkpoints, an
append-only table with one explicit root and at most one successor per
predecessor in a chain keyed by source provider/scope and analysis
task/version. The new createPostgresSourceBatchStore accepts synthetic
inputs only. initialize explicitly binds the trusted previous membership;
acknowledge derives the batch receipt from verified pages and completions
using the existing ledger transaction lock and same connection. It checks
the stored predecessor membership before insertion. A fresh client reads
back the exact receipt digest; missing or ambiguous state remains explicit.
readTip observes the current chain tip, not a grant to access source history.

The schema and adapter have been exercised on disposable PostgreSQL 16
using the existing heavy-postgres contract, including partial work,
wrong predecessor/membership, competing successors, replay and append-only
grants. The concurrent regression now starts the second contender only after the
first holds the ledger lock, asserts that the first COMMIT succeeded before
the synthetic acknowledgement error, and checks exact independent readback.
The hosted heavy-postgres workflow is the acceptance witness.
Persisted receipt readback checks envelope, chain and digest; it assumes
trusted ledger writers, not cryptographic authentication of source.
No runtime migration of Neon, deployment, pending-batch custody,
empty/removal disposition, or real source access is included.

### Pending source plan custody (issue #65)

The existing verified batch admission also prepares an immutable plan
before model execution. It retains the full handoff and source witnesses,
predecessor, task/version, work and packet/request/evidence fingerprints.
It does not retain message bodies. The source_plans table belongs to
the existing ledger and references its exact source checkpoint parent.
Stage and lookup use the existing connection boundary; staging uses the
ledger transaction lock and independent exact digest readback. New
plans require an unadvanced compatible parent, while exact repeats are
idempotent. Distinct rederived witnesses can coexist without replacing
the original. Lookup is bounded and throws rather than treating a
missing parent, corrupt readback or excessive results as no plans.

Synthetic-only; no production migration. Staging is not yet enforced
before reservation, and completion-to-original-plan linkage remains
open (different witnesses can share a packet ID). Neither staging nor
lookup authorizes stale source reads or advances the checkpoint.
Actual source custody, real metadata retention and recovery budgets
require separate acceptance. The fast tests cover stable work identity
across distinct source witnesses; hosted PostgreSQL checks restart and
unchanged checkpoint with unprocessed work. The additional PostgreSQL
generation-change scenario has not been executed.

### Staged source work admission

The synthetic source-specific runSelected entry point now derives the exact
plan and selected input, then verifies the existing unadvanced predecessor
and durable plan under the ledger transaction lock before reserving work.
It uses the ordinary durable runner and ordinary completion store. A new
source_work_origins association is inserted atomically with a reservation;
foreign keys bind the original staged plan and work reservation. No
transaction remains open during inference. Missing plan or unavailable
storage blocks execution. An existing reservation with no source origin
is not accepted as source-specific custody. The original association is
never relabelled when a reservation is encountered again.

The generic synthetic pilot remains independently usable. This is not a
global enforcement boundary for arbitrary SQL writers or a grant to
read real history. Source receipt linkage to the original plan is still
open; source checkpoint acknowledgement is separate. No live migration
or model calls. Hosted PostgreSQL tests cover missing plan, staged
execution and restart with the original association and no extra calls.

### Original plan binding in source acknowledgement

The durable acknowledgement now requires an exact current staged plan
and the original source-work association for every independently verified
completion. Within the existing ledger transaction lock it validates
the original plan's packet, request and evidence fingerprints against
the completion. Generic pilot completions without a source-work origin
cannot advance this source chain. No schema change is needed.

The portable receipt remains a v1 candidate. The stored v2 receipt
adds the current plan fingerprint and ordered original plan pointers
(work identity, original predecessor and original plan fingerprint).
A later equivalent witness cannot replace the original plan. Existing
v1 stored receipts remain readable as historical receipts without a
claim of this stronger binding. All new acknowledgements use v2.
The complete receipt digest and independent readback remain required.
The PostgreSQL regression covers different staged witnesses, unbound
completion rejection, exact readback and commit acknowledgement loss.
It uses synthetic source links; a full cross-generation recovery and
real source custody policy remain separate acceptance questions.

### Cross-generation recovery regression

`qa/postgres/generate-source-refresh-fixture.py` derives two observations
from the actual pinned Session Search producer (3b7b536): accepted export,
bundle verification, rederived membership and selected evidence index.
The second observation ingests an unrelated synthetic conversation and
rebuilds the source generation; two original selected sessions retain
content identity while the selected set expands to four. Page bodies are
simulated serving from independently verified bundle rows, not live
reader receipts. The checked-in fixture is synthetic and reproducible
in structure; timestamps in accepted ledger receipts can vary.

The hosted PostgreSQL contract stages the old plan and completes one
work, then restarts with the rederived new plan. Mixed old/new pages must
be rejected; unchanged work is reused, the other three works complete,
and acknowledgement binds the expanded membership with original plan
pointers for both generations. No duplicate model calls, real provider
traffic, local PostgreSQL or live source migration. This verifies the
consumer recovery boundary, not live cross-generation source transport.
