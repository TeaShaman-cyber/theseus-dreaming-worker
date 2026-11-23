# Dreaming Worker specifications

This directory is the durable map from project intent to implementation work.

## Where we are

### Implemented

- `pilot1/bounded-inference` — one bounded external model inference with exact provenance, typed proposals, deterministic runtime receipt, and no tool/memory authority.
- `pilot2/independent-perspectives` — pure two-pass orchestration over two configured-distinct model families, preserving typed failures and first-pass disagreement with `COMPLETE | PARTIAL | NO_DATA | FAIL_CLOSED`.
- `pilot2/live-provider-composition` — bounded runtime-agnostic live composition over explicit provider routes, with a publication-safe `COMPLETE` acceptance artifact.
- `pilot2/critique-contract` — deterministic input/provenance contract for analyzing frozen Pilot 2 perspectives without turning critique into truth authority.
- `pilot2/live-critique` — one bounded live critique call over frozen perspectives with deterministic `DERIVED_ONLY` validation.
- `ledger/append-only-proposals` — append-only proposal history contract with content-addressed records and explicit supersession semantics.

### Designed, not applied

- `ledger/neon-persistence` — dedicated `dw_ledger` Neon/Postgres persistence boundary and future Session Search read seam; SQL is versioned but not applied.

### Recovered core design

- `worker/core-contract` — what Dreaming Worker is and is not.
- `intake/session-search-boundary` — why real unattended Session Search history is still a separate authorization/reader problem.

## Important boundary

A spec without `spec-lock.json` is not claimed to have an implementation link yet.

The general worker contract and the real Session Search intake boundary remain specifications for future work. Their implementation links should be generated only when stable implementation symbols actually exist.

## Immediate next coding task

The append-only proposal-ledger contract is implemented. The next persistence step is to implement a narrow storage adapter against the versioned `dw_ledger` contract, keeping these boundaries:

1. reuse the existing Dreaming Worker Hyperdrive/Neon boundary;
2. write only validated ledger events; never mutate or delete history;
3. keep Session Search access read-only and separate from source/shard search hits;
4. validate the migration on a disposable database branch before any production DDL;
5. do not add scheduler/checkpoint, private Session Search intake or production release authority as part of the storage adapter.

Clef remains a separate researched decision/relevance layer candidate and is not counted as one of the two analytical perspectives.
