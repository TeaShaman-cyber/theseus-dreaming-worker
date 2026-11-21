# Dreaming Worker specifications

This directory is the durable map from project intent to implementation work.

## Where we are

### Implemented

- `pilot1/bounded-inference` — one bounded external model inference with exact provenance, typed proposals, deterministic runtime receipt, and no tool/memory authority.

### Recovered core design

- `worker/core-contract` — what Dreaming Worker is and is not.
- `intake/session-search-boundary` — why real unattended Session Search history is still a separate authorization/reader problem.

### Next implementation

- `pilot2/independent-perspectives` — two genuinely independent model families analyze the same safe evidence packet before seeing each other's output; disagreement is preserved and consensus is not truth.

## Important boundary

A spec without `spec-lock.json` is not claimed to have an implementation link yet.

Pilot 2, the general worker contract, and the real Session Search intake boundary are specifications for future work. Their implementation links should be generated only when stable implementation symbols actually exist.

## Immediate next coding task

Implement the first bounded Pilot 2 slice on `SYNTHETIC_FIXTURE` / `PUBLICATION_SAFE` only:

1. explicit provider/model/model-family identities;
2. two blind first passes over the exact same evidence/request fingerprints;
3. reuse Pilot 1 schema + provenance validation per pass;
4. `COMPLETE | PARTIAL | NO_DATA` outcome;
5. preserve both proposal sets and typed failures;
6. deterministic disagreement/comparison structure with no truth vote.

Do not add critique, private Session Search intake, a durable ledger, or automatic memory promotion in that first increment.
