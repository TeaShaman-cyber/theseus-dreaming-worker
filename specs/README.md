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

### Recovered core design

- `worker/core-contract` — what Dreaming Worker is and is not.
- `intake/session-search-boundary` — why real unattended Session Search history is still a separate authorization/reader problem.

## Important boundary

A spec without `spec-lock.json` is not claimed to have an implementation link yet.

The general worker contract and the real Session Search intake boundary remain specifications for future work. Their implementation links should be generated only when stable implementation symbols actually exist.

## Immediate next coding task

After bounded live critique, define the append-only proposal-ledger contract before choosing a durable database:

1. preserve exact Proposal v1 content, fingerprints and source provenance;
2. represent revision only through explicit supersession events; never overwrite history;
3. keep every ledger entry `DERIVED_ONLY`; active/superseded state is not truth promotion;
4. fail closed on forged IDs, broken references, self-links and cycles;
5. keep durable storage selection, private Session Search intake, scheduler/checkpoint and canonical-memory promotion out of this increment.

Clef remains a separate researched decision/relevance layer candidate and is not counted as one of the two analytical perspectives.
