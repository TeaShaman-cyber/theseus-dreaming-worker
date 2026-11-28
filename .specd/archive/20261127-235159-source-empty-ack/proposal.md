# Proposal: source-empty-ack

## Motivation

Issue #122: actual producer recapture changes accepted membership from 7 to 11 artifacts without changing any session; ordinary cycle correctly refuses automatic acknowledgement.

## Current behaviour

NO_SELECTED_WORK retains prior progress. Repeated provenance-only refresh can leave consumer membership behind.

## Proposed solution

An explicit trusted-custody synthetic no-work acknowledgement, using the same append-only checkpoint transaction and exact readback. No automatic acknowledgement from an empty retrieval.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: explicit custody-only acknowledgement.
- `default:ledger/postgres-storage`: distinct no-work checkpoint receipt and pending-plan exclusion.

## Impact

No new schema, grants, inference, scheduling or deployment. Ordinary empty cycle remains read-only.
