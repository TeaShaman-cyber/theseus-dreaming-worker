# Dreaming Worker specifications

This directory is the durable map from project intent to implementation work.

## Where we are

### Implemented

- `pilot1/bounded-inference` — one bounded external model inference with exact provenance, typed proposals, deterministic runtime receipt, and no tool/memory authority.
- `pilot2/independent-perspectives` — pure two-pass orchestration over two configured-distinct model families, preserving typed failures and first-pass disagreement with `COMPLETE | PARTIAL | NO_DATA | FAIL_CLOSED`.

### Recovered core design

- `worker/core-contract` — what Dreaming Worker is and is not.
- `intake/session-search-boundary` — why real unattended Session Search history is still a separate authorization/reader problem.

## Important boundary

A spec without `spec-lock.json` is not claimed to have an implementation link yet.

The general worker contract and the real Session Search intake boundary remain specifications for future work. Their implementation links should be generated only when stable implementation symbols actually exist.

## Immediate next coding task

After this pure orchestration slice is promoted, add a bounded live provider-adapter smoke for `SYNTHETIC_FIXTURE` only:

1. pass transport/provider model identity into the existing Pilot 2 route contract;
2. normalize timeout, JSON-validation, empty-final-content, and output-budget exhaustion into typed pass failures;
3. prove one `COMPLETE`, one `PARTIAL`, and one `FAIL_CLOSED` synthetic run against approved provider routes;
4. keep critique, Clef routing, private Session Search intake, durable ledger, scheduler, and automatic memory promotion out of that increment.

Clef remains a separate researched decision/relevance layer candidate and is not counted as one of the two analytical perspectives.
