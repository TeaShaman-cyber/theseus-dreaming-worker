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
Readback independently binds the receipt to its fingerprint (ordered
tuple, not JSONB key order). Competing successors, incomplete work,
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
and is not yet persisted with the completion. The existing durable runner
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
