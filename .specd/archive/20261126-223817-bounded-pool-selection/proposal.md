# Proposal: bounded-pool-selection

## Motivation

Issue #89: fixed model pairs become unavailable when a model retires or a provider limits requests. Offline research and provider probes show that catalog presence and successful transport are not quality admission.

## Current behaviour

Pilot 2 consumes an explicit pair; source orchestration reuses it. Partial recovery is not implemented.

## Proposed solution

A pure bounded pool selector chooses ready routes for the missing independent slots, based on caller-provided admission, task qualification, catalog freshness, cooldown, and attempt budget. Keep the current pair executor unchanged in this increment.

## Specs affected

### New specs

None.

### Modified specs

- `default:pilot2/independent-perspectives`: add a separately staged pool selection contract.
  - Depends on (added): none

## Impact

No inference, provider, durable state, spend authority, source cursor or operational configuration changes. This is not full #89 acceptance.

## Technical context

Research/model-pool replay, Hindsight audit, #89 and #65. Reuse existing route identity and pure deterministic decisions.

## Open questions

Durable attempt ownership, partial recovery, actual adapter failure evidence and source-batch integration are next increments.
