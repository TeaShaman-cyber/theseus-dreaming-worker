# Proposal: source-handoff-decoder

## Motivation

Issue #65 and accepted SS PR349 supply a private recovery candidate but the consumer lacks strict intake validation.

## Current behaviour

The existing worker consumes typed evidence packets, not a source membership transition.

## Proposed solution

Validate the existing source candidate against the trusted expected predecessor, provider, scope and observed catalog. Do not admit analysis or acknowledge a source transition by decoding alone.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: validate recovery candidate identity and placement.
  - Depends on (added): none

## Impact

Portable deterministic decoder and regression tests; no network, storage, new service or permission.

## Technical context

Reuse SS #349 wire contract and existing SHA helper. Preserve unknown currentness and removal obligations; source authentication is external to digest validation.

## Open questions

Exact evidence references, bounded execution and durable source acknowledgement remain separate increments.
