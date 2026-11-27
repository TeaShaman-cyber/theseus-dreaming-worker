# PostgreSQL Ledger Storage Adapter

## Purpose

Persist validated append-only proposal-ledger events through the existing Cloudflare Hyperdrive/PostgreSQL boundary while preserving the in-memory ledger contract.

The current Cloudflare/Neon resource set is a development/test environment. Cloudflare CLI `production` mode names a technical deploy mode only and is not evidence of a real production deployment.

## Requirements

### Requirement: Connection boundary

The adapter receives the existing Hyperdrive PostgreSQL connection string. It does not receive a Neon control-plane API key and does not create database resources.

A fresh `pg.Client` is created for each adapter operation. Hyperdrive owns connection pooling.

### Requirement: Append behavior

Before insert, append acquires one transaction-scoped advisory lock, reads and revalidates persisted ledger history, and applies the existing `appendLedgerEvent` contract to the candidate event.

Only after validation succeeds does the adapter issue a parameterized `INSERT`. There is no UPDATE or DELETE method.

On any validation or database error the transaction is rolled back and the client is closed.

### Requirement: Work reservation and atomic completion

Work identity MUST use the deterministic checkpoint identity before inference. Only the caller with a confirmed unique durable reservation MAY execute the bounded passes. Existing, unavailable or ambiguous reservation state MUST NOT cause repeat inference.

A complete candidate MUST bind the exact work, request and analysis-result fingerprints to validated derived proposal records, distinct work-scoped perspectives and observed provider/model/finish metadata. No raw response retention is required. Duplicate record identities within one batch MUST fail closed.

All new records, completion and ordered record membership MUST commit together under the existing ledger transaction boundary. Completion MUST reference the reservation owner. Readback MUST verify record identities and the durable projection fingerprint; that fingerprint is distinct from the original in-memory analysis hash. An ambiguous commit MUST be resolved by readback, or remain explicit UNKNOWN, never by repeating inference.

An incomplete analysis MUST NOT produce a completion. The in-memory analysis and any uncommitted candidate MUST remain distinct from verified durable completion. Reservations without completion remain unresolved, without automatic takeover. Work completion is not a source-level cursor or canonical truth.

### Requirement: Explicit completion-only recovery

When a validated complete candidate cannot be confirmed as committed, the trusted caller MAY retain its exact candidate and original reservation correlation. An explicit recovery invocation MUST validate the candidate and inspect the durable completion first. If an exact completion exists, return it without writing. If the read is unavailable, corrupt or conflicts with the candidate, do not write.

Only an observed absent completion MAY permit one transaction using the original reservation correlation and unchanged candidate. Independently verify the result by readback even after an error. Recovery MUST NOT acquire another reservation, invoke inference, change the candidate or take over an unresolved reservation. The envelope is trusted caller custody, not a new authorization mechanism. Lost or incomplete analysis is outside this recovery boundary.

### Requirement: Bounded durable attempt journal

A separately admitted pooled work journal MUST bind an existing unique reservation to exact work, request and evidence fingerprints and an explicit finite lifetime attempt budget. It MUST NOT adopt a legacy unresolved reservation. The journal MUST be append-only, with independently validated exact ordered event identities.

Starting an attempt MUST require the exact prior journal tip, a vacant perspective slot and no pending or unknown outcome. The storage transaction MUST prevent concurrent dispatch admission. A validated terminal outcome MUST preserve the actual route and observed provider/model and exact provenance; a known failed attempt MAY permit a different route for the same missing slot. A frozen validated perspective MUST NOT be overwritten or repeated. The second validated family MUST differ from the first. Every attempted route and typed terminal outcome remains visible. Pending or unknown state MUST NOT be automatically retried.

An uncertain start acknowledgement MUST NOT grant dispatch. An outcome is accepted only after independent readback. The journal itself MUST NOT grant model entitlement, call providers, create completion or advance source progress. Durable final completion and source acknowledgement require their existing separate acceptance boundaries.

### Requirement: Explicit resumable pooled execution

An explicitly invoked pooled executor MUST compose the existing admitted bounded inference adapters, model pool selector and durable journal. It MUST validate no-data before inference and replay verified completion without inference. It MUST confirm a unique durable start and exact readback before dispatching one missing slot. The total durable starts and per-invocation callbacks MUST remain independently bounded; successful slots MUST NOT be rerun.

Known responded failures MAY allow replacement; unknown outcome or uncertain storage MUST stop. Rate-limit observations MUST honor a known Retry-After, conservatively scoped to the provider when no narrower scope is established. If no safe wait is known or credentials/billing are refused, that provider MUST be excluded for this work until a separately authorized recovery mechanism exists. A model identity mismatch, non-stop finish, invalid proposal or duplicate ledger record MUST NOT freeze a slot.

The completed pooled projection MUST use the existing validated work completion and atomic recovery boundary, bind its result fingerprint to the final immutable journal entry, and independently verify exact readback. Completed replay of a pooled work MUST agree with its journal. No-data, incomplete, blocked or deferred states MUST NOT manufacture completion. This API MUST NOT alter the existing source-plan admission, fixed-pair source batch or production deployment; caller-supplied route admission and cross-work cooldown evidence remain external.

### Requirement: Pooled completion custody

The ordinary completion writer MUST refuse work with a pooled attempt journal. The explicit pooled completion writer MUST bind the original exact input, reservation owner and complete journal to the candidate projection under the existing ledger transaction lock, before inserting any derived records. Missing, unresolved, mismatched or incomplete journal custody MUST NOT create completion. The writer MUST recompute the exact projection using the same deterministic builder as the executor. Existing ordinary completion and source acknowledgement boundaries remain unchanged. This is a trusted application-writer invariant, not a new ACL.

### Requirement: Durable source batch acknowledgement

The synthetic source store MUST initialize a root only explicitly from a trusted predecessor membership. Acknowledgement MUST bind one existing predecessor and its exact membership, provider, scope, task and analysis version. It MUST derive the receipt using the existing verified batch builder and read completions within the existing transaction/lock boundary. No caller-provided work list or receipt may bypass this derivation.

Source checkpoints MUST be append-only with one root and at most one successor per predecessor and chain. A missing or conflicting predecessor, incomplete work, corrupt storage or unresolved removal MUST NOT advance the chain. An ambiguous write MUST be resolved by independent exact readback or remain UNKNOWN. Acknowledgement MUST NOT invoke inference, enable real history access or imply source completeness.

### Requirement: Pending source plan custody

The synthetic source store MUST support explicitly staging an immutable plan derived from the exact verified selected work under the existing predecessor and analysis intent. A plan MUST retain the complete handoff, original packet and request identities, work identities and source witnesses, but no evidence bodies. Staging MUST NOT advance the acknowledged source checkpoint or invoke inference.

The plan MUST be bound to the existing source chain and predecessor, use the existing ledger transaction lock, and be independently read back. Exact repeats MUST be idempotent. Distinct rederived witnesses MAY coexist for the same predecessor while it remains the tip; an acknowledged predecessor MUST NOT admit new plans. Restart lookup MUST validate stored digest and binding and MUST distinguish unavailable/corrupt storage from no plans. A plan alone is not permission to execute or replay stale evidence.

### Requirement: Staged source work admission

Source-specific synthetic execution MUST derive the exact selected work from verified input and require the matching durable plan before reservation. Under the existing transaction lock it MUST verify the unadvanced predecessor and atomically bind a new work reservation to its exact original plan. Missing, corrupt or unavailable plan state MUST prevent inference. Existing reservations MUST NOT be taken over or relabelled; an unbound reservation cannot establish source custody.

The existing durable runner MUST remain responsible for inference and completion; source-specific admission MUST NOT advance the source checkpoint, grant access or change generic pilot behavior.

### Requirement: Same-plan pooled source admission

Explicit synthetic pooled selected work MUST derive its exact input from the verified staged plan. New reservation, initial journal entry and immutable source origin MUST commit atomically under the existing ledger lock. Existing work MUST have the same exact original plan and work identity; unbound or differently bound work MUST NOT be adopted. Journal mutations MUST require the exact staged plan and unadvanced predecessor. Readback MUST verify original plan custody; exact completed replay MUST use zero inference. The pooled executor MUST NOT advance source progress. Existing acknowledgement MUST verify all selected completions and original origins. Cross-plan partial recovery and cross-work cooldown persistence remain outside this increment.

### Requirement: Same-plan finite provider cooldown

Within an exact staged synthetic source plan, the pooled selector MUST incorporate known finite provider-scoped HTTP 429 Retry-After deadlines from journal events of source-bound work. It MUST use the maximum deadline for each applicable provider and MUST NOT infer account-wide quotas or propagate indefinite or unknown outcomes as finite waits. Before a new START is inserted, the same ledger lock MUST protect a fresh check of the applicable deadline; a newly active restriction MUST defer without recording START or dispatching inference. An already admitted START is not revoked. Provider identities MUST be stable caller-provided keys within this plan. Other plans MUST NOT supply these restrictions. Expired waits MUST NOT prevent otherwise eligible selection.

### Requirement: Source acknowledgement retains original plan

A durable source acknowledgement MUST require the exact current staged plan and verify each completion against its immutable original reservation plan under the existing transaction lock. An unbound completion MUST NOT advance source progress. The durable receipt MUST bind both the current plan and each original plan pointer, and verify the original packet, request and evidence identities against the completion. A later witness MUST NOT relabel the original work origin.

### Requirement: Read behavior

Proposal and supersession rows share one global database event sequence. Reads combine both tables ordered by that sequence and revalidate each reconstructed event through the existing append-only ledger contract before returning it.

Persisted rows therefore do not gain authority merely by being stored in PostgreSQL.

### Requirement: QA layers

Fast unit tests use a small client fake for SQL mapping, rollback, cleanup and validation boundaries.

Hosted Heavy PostgreSQL starts the PostgreSQL 18 service already present on the current GitHub runner, replays the migration twice, verifies grants/FKs/shared sequence, and exercises the real adapter.

Neon schema-only preview remains a separate provider-specific compatibility check.

## Non-scope

No automatic Dreaming Worker invocation, scheduler, Session Search read tool, external API route, real production deployment, or application of `dw_ledger` to the long-lived cloud development/test database is part of this increment.

## Spec Dependencies

- `default:ledger/append-only-proposals`
- `default:ledger/neon-persistence`
- `default:intake/session-search-boundary`
