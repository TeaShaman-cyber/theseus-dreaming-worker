# Neon Ledger Persistence Boundary

## Purpose

Persist the already-defined append-only proposal ledger in the existing Dreaming Worker Neon boundary without coupling ledger history to Session Search shard storage or Mastra internal tables.

## Requirements

### Requirement: Physical boundary

The intended durable boundary is the existing issue-owned Dreaming Worker Neon project/database:

- project: `theseus-ss-dreaming-issue23`;
- database: `dreaming_issue23`;
- existing Mastra schema: `dw_issue23`;
- ledger schema: `dw_ledger`.

`dw_ledger` MUST remain separate from `dw_issue23`. Session Search shard projects and the Session Search feedback store are separate ownership surfaces and MUST NOT be reused for Dreaming Worker ledger tables.

### Requirement: Tables

`proposal_records` stores immutable Proposal v1 records with exact proposal, route and source/provenance fingerprints.

`supersession_events` stores immutable links from one existing proposal record to another. PostgreSQL foreign keys enforce that both endpoints exist and a CHECK rejects self-supersession.

Database persistence does not replace application-ledger validation. The application contract remains responsible for content-addressed ID recomputation, exact Proposal v1 fingerprint verification and supersession-cycle detection before insert.

### Requirement: Runtime authority

The existing Hyperdrive runtime role `dw_runtime_issue23` may receive:

- `USAGE` on `dw_ledger`;
- `SELECT` and `INSERT` on ledger tables;
- sequence usage required by identity columns.

It MUST NOT receive `CREATE`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` authority on ledger objects. Schema/bootstrap remains an owner/control-plane operation.

Every persisted ledger record remains `DERIVED_ONLY`. PostgreSQL persistence does not promote a hypothesis into source truth, memory, instruction or permission.

### Requirement: Session Search read boundary

The future ChatGPT-facing route should remain inside the Session Search product surface while preserving authority separation:

`Session Search tool -> bounded Dreaming Worker ledger reader -> dw_ledger`.

Session Search MUST NOT receive the Dreaming Worker runtime database credential. A future tool such as `session_hypotheses` should expose a bounded read-only representation whose results are explicitly marked `DERIVED_ONLY` and are not merged invisibly into ordinary source/shard search hits.

## Current implementation status

The versioned ledger DDL and storage adapter have passed disposable hosted PostgreSQL tests and a separate Neon schema-only preview (#77). This does not establish application to the long-lived Neon database, operational worker integration, go-live or new access authority. No live migration is authorized by this specification.

## Spec Dependencies

- `default:ledger/append-only-proposals`
- `default:worker/core-contract`
