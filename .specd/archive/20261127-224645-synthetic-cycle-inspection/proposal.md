# Proposal: synthetic-cycle-inspection

## Motivation

Issue #117: after actual process loss, the operator needs to inspect existing durable state without invoking the worker again.

## Current behaviour

The accepted pooled cycle supports recovery, but the operator must separately query its stores.

## Proposed solution

A thin read-only synthetic batch diagnostic using existing validated source plan, tip, journal and completion readers.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: explicit read-only synthetic custody observation.
  - Depends on (added): none

## Impact

No writes, retries, new permissions, real source access, scheduling or deployment.
