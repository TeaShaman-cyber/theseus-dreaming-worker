# Dreaming Worker specifications

This directory is the durable map from project intent to implementation work.

## Where we are

### Implemented

- `pilot1/bounded-inference` — one bounded external model inference with exact provenance, typed proposals, deterministic runtime receipt, and no tool/memory authority.
- `pilot2/independent-perspectives` — pure two-pass orchestration over two configured-distinct model families, preserving typed failures and first-pass disagreement with `COMPLETE | PARTIAL | NO_DATA | FAIL_CLOSED`.
- `pilot2/live-provider-composition` — bounded runtime-agnostic live composition over explicit provider routes, with a publication-safe `COMPLETE` acceptance artifact.
- `pilot2/critique-contract` — deterministic input/provenance contract for analyzing frozen Pilot 2 perspectives without turning critique into truth authority.

### Recovered core design

- `worker/core-contract` — what Dreaming Worker is and is not.
- `intake/session-search-boundary` — why real unattended Session Search history is still a separate authorization/reader problem.

## Important boundary

A spec without `spec-lock.json` is not claimed to have an implementation link yet.

The general worker contract and the real Session Search intake boundary remain specifications for future work. Their implementation links should be generated only when stable implementation symbols actually exist.

## Immediate next coding task

After the deterministic critique contract is promoted, add one bounded critique inference over the frozen critique input:

1. use the generated critique JSON Schema as the model-facing output contract;
2. accept only the already-built frozen critique input; do not fetch new evidence;
3. validate every proposal/evidence reference deterministically;
4. keep the result `DERIVED_ONLY` and preserve the two original perspectives unchanged;
5. keep private Session Search intake, durable ledger, scheduler, routing heuristics, and canonical-memory promotion out of that increment.

Clef remains a separate researched decision/relevance layer candidate and is not counted as one of the two analytical perspectives.
