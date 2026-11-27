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

### Implemented and verified in isolated environments; not operational

- `ledger/neon-persistence` — dedicated `dw_ledger` Neon/Postgres persistence boundary and future Session Search read seam; SQL is versioned and tested on disposable PostgreSQL and Neon schema-only previews; the accepted migration is also applied to the dedicated issue23 cloud development/test database (#23), with independent grant readback.
- `ledger/postgres-storage` — `pg` storage adapter plus hosted PostgreSQL contract lane over the existing Hyperdrive boundary.

### Core contract and bounded intake

- `worker/core-contract` — what Dreaming Worker is and is not.
- `intake/session-search-boundary` — why real unattended Session Search history is still a separate authorization/reader problem.

## Important boundary

A spec without `spec-lock.json` is not claimed to have an implementation link yet.

The worker contract remains a cross-cutting contract. The intake implementation links cover only the verified synthetic consumer, not the future real-data reader. The legacy spec-lock mappings are checked independently of the native graph; SpecD 0.2.0 uses generated metadata for native dependency context.

## Immediate next coding task

The storage adapter and synthetic source-batch recovery were accepted in hosted PostgreSQL 18. The separately authorized bounded persistence canary is now verified (#23): actual Cloudflare edge preview, existing Hyperdrive and dedicated Neon development/test database, synthetic-only execution and zero-call replay. See [QA witness](../qa/cloudflare/README.md). All persisted proposals remain DERIVED_ONLY. This does not establish an operational deployed agent; private Session Search intake remains deferred.

Next: finish the read-only source custody inspector (#117/#118), and connect the existing Session Search native HTTP browse candidate (Session Search #345/PR346, Theseus Research #127/PR140) to the trusted accepted-membership/current catalog handoff on synthetic fixtures. Verify exact source identity, gaps, bounded pages, and generation pinning before any real intake. Do not treat route-level authorization as source custody or private-data egress approval.

Clef remains a separate researched decision/relevance layer candidate and is not counted as one of the two analytical perspectives.
