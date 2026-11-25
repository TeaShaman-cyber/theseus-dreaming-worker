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

### Requirement: Read behavior

Proposal and supersession rows share one global database event sequence. Reads combine both tables ordered by that sequence and revalidate each reconstructed event through the existing append-only ledger contract before returning it.

Persisted rows therefore do not gain authority merely by being stored in PostgreSQL.

### Requirement: QA layers

Fast unit tests use a small client fake for SQL mapping, rollback, cleanup and validation boundaries.

Hosted Heavy PostgreSQL starts the PostgreSQL 18 service already present on the current GitHub runner, replays the migration twice, verifies grants/FKs/shared sequence, and exercises the real adapter.

Neon schema-only preview remains a separate provider-specific compatibility check.

## Non-scope

No automatic Dreaming Worker invocation, scheduler, Session Search read tool, external API route, real production deployment, or application of `dw_ledger` to the long-lived cloud development/test database is part of this increment.
