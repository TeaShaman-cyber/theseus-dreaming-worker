# Proposal: source-batch-receipt

## Motivation

Issue #65: PR74 proved source-batch acknowledgement in disposable PostgreSQL. Runtime needs an exact validated candidate rather than trusting an arbitrary work list.

## Current behaviour

Verified selected-session work is prepared individually; batch receipt construction exists only in QA.

## Proposed solution

Derive the complete selected work set using the existing adapter. Read independently verified completions and bind their evidence references to the selected work. Return a digest-bound candidate including full membership and lineage witness, without advancing the source checkpoint.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: exact batch receipt preparation.
  - Depends on (added): none

## Impact

Portable synthetic-only receipt builder and tests; no inference, migration or network.

## Technical context

Reuse the existing handoff decoder, page verifier and work completion validator. Distinguish current source witness from original inference custody.

## Open questions

Durable pending custody, storage adapter, root provisioning, empty/removal dispositions and live source authority remain separate.
