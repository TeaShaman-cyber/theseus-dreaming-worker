# Proposal: require-change-coverage

## Motivation

A structurally valid spec and an empty active-change list can still allow a runtime code change without any SpecD record. The user requested an obligatory gate, not optional advice.

## Current behaviour

The canonical gate checks spec structure and existing active records. It does not compare the Git diff to the scope of a fresh native change.

## Proposed solution

Require freshly archived native SpecD changes covering protected runtime paths in the exact PR diff. Use native lifecycle status in a disposable snapshot to verify the archived artifacts. Keep semantic conformance as an independent review judgment.

## Specs affected

### New specs

None.

### Modified specs

- `default:worker/core-contract`: no normative change; implement the existing deterministic-sufficiency review boundary.
  - Depends on (added): none

## Impact

Canonical QA, hosted verify, regression tests and agent instructions. No worker runtime or permissions changes.

## Technical context

Issue #52 and PRs #60 and #61 established pinned validation and lifecycle. Existing Git path classification informs scope. Avoid a second manifest format; use the native design's explicit affected file entries and fresh archive state.

## Open questions

None for this bounded structural coverage check. Semantic correctness remains review work.
