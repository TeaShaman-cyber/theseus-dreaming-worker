# Proposal: pooled-refresh-completion

## Motivation

Issue #120: real isolated PostgreSQL plus actual synthetic native browse handlers reproduces a false STORAGE_UNKNOWN for completed pooled work after a new generation.

## Current behaviour

Same-plan journal validation blocks an alternative witness even when durable completion exists.

## Proposed solution

Read-only verification of the original source-bound completion and journal under the original request identity reconstructed from the newly verified equivalent content. Never adopt incomplete journal custody.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: completed pooled work reuse.
  - Depends on (added): none

## Impact

Synthetic scope only. No new DB schema, permission or real-source access.
