# Proposal: pool-completion-trace-correction

## Motivation

Hosted verify at 7551380 rejected pool-completion.ts because the archived design used colon delimiters after backticked paths. The invariant, tests and source are already present.

## Current behaviour

Native archive is structurally valid but exact committed diff coverage misses the new builder.

## Proposed solution

Record a corrective native change with exact affected paths, preserving prior archive and requirement. No runtime change.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: trace correction only.
  - Depends on (added): none

## Impact

No policy or requirement changes.
