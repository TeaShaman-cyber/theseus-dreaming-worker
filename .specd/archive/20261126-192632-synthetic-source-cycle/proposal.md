# Proposal: synthetic-source-cycle

## Motivation

Issue #65: acquisition and durable execution are already tested together manually but lack one explicit worker invocation. Empty selections and removal obligations are rejected implicitly instead of receiving useful dispositions.

## Current behaviour

Callers compose bounded acquisition, selected-work execution and acknowledgement themselves. No real unattended intake authority exists.

## Proposed solution

Provide one portable synthetic cycle over existing primitives, with explicit preflight, bounded acquisition, execution result and safe stop dispositions.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: bounded cycle with explicit no-work and failure outcomes.
  - Depends on (added): none

## Impact

Portable worker entrypoint and existing tests. No new model stage, database, provider, permission or service.

## Technical context

Require caller-owned trusted handoff, indexes, transport, budget, routes and store. Preserve currentness unknown. Never advance an empty or removal-containing handoff.

## Open questions

Durable resolution of removals and changed-but-empty membership, real source custody and deployment are separate work.
