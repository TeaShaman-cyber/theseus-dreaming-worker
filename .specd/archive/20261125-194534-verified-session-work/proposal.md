# Proposal: verified-session-work

## Motivation

Issue #65 needs the source-side selected metadata and existing pinned conversation reader joined to the existing analysis input.

## Current behaviour

The worker can decode a recovery candidate but cannot verify retrieved message bodies against the selected source metadata.

## Proposed solution

A portable deterministic adapter validates bounded pages of one selected session against its trusted metadata and prepares the existing durable runner input. Preserve exact lineage separately from content-dependent work identity.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: refine verified evidence admission for synthetic recovery.
  - Depends on (added): none

## Impact

Pure adapter, synthetic regression fixture and tests. No live access, inference, scheduler or storage migration.

## Technical context

Reuse the existing reader and durable Pilot2. Retain portability and distinguish new generations from new content.

## Open questions

Trusted custody and source authentication, complete batch acknowledgement, production budgets and real access remain separate.
