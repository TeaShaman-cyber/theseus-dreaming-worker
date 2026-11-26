# Proposal: source-batch-acquire

## Motivation

Issue #65: verified page admission currently requires an independently populated array. The native browse prototype supplies bounded pinned reads.

## Current behaviour

Page count and character limits apply after acquisition, not to transport.

## Proposed solution

Compose the native request shape with an injected synthetic reader. Validate exact selection/index before reading; bound response bytes, requests and deadlines; verify full pages using existing admission.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: bounded acquisition.
  - Depends on (added): none

## Impact

Portable synthetic consumer only. No credential, default network client, live endpoint or storage.

## Technical context

Existing SS native browse contract (#345/#346), existing source handoff and selected-page validation.

## Open questions

Production machine identity, accepted-source delivery and egress/retention remain separate.
