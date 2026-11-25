# Proposal: checkpoint-aware-pilot2

## Motivation

Research #127 and issue #63 require repeated unchanged work to incur no new inference and checkpoints to advance only after bounded success.

## Current behaviour

Pilot 2 validates one packet and invokes independent passes. It has no accepted-source checkpoint admission boundary.

## Proposed solution

Compose a deterministic admission and candidate-checkpoint layer around the existing runner. Require exact source identity, versioned analysis intent, explicit checkpoint read state and stable evidence identity. Never treat a partial or stale empty packet as no data.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: refine checkpoint and intake failure requirements.
  - Depends on (added): none

## Impact

Portable synthetic/publication-safe execution only. No storage, lease, unattended reader, scheduling, model routing or deployment.

## Technical context

Reuse Pilot 0/2 and Proposal v1. Core deterministic-sufficiency requirement applies.

## Open questions

Durable atomic commit and source completeness are deferred to separate authorized integration.
