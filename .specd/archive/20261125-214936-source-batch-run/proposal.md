# Proposal: source-batch-run

## Motivation

Issue #65: source plan, selected execution and acknowledgement are verified primitives but require manual composition.

## Current behaviour

Callers invoke each primitive independently.

## Proposed solution

Portable bounded composition over the existing source store. Validate exact plan and route shape before execution; stage, process ordered selected work within an explicit pass budget, stop on uncertainty, and acknowledge only verified full success.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: bounded synthetic source batch run.
  - Depends on (added): none

## Impact

No new database schema, model stage or live source access.

## Technical context

Use existing verified batch preparation, source-specific reservation and durable acknowledgement. Replay checks existing acknowledgement first. No implicit root initialization.

## Open questions

Acquisition transport and machine identity, source dispositions and real-data retention remain separate.
