# Proposal: source-equivalent-mutants

## Motivation

Issue #104: hosted runs show seven remaining batch mutants and one cycle mutant after strengthening genuine behavioral witnesses. Preserve runtime defenses and classify only behaviorally equivalent mutations.

## Current behaviour

Mutation gates fail on redundant exact staged-plan checks, preflight constants, the independently enforced invocation cap, and a swallowed internal error string.

## Proposed solution

Isolate redundant expressions so mutation directives cannot mask independent checks. Retain all runtime guards and the threshold of 100; document exact ignored replacements and assumptions. Remove an unobservable internal error message or isolate its string mutation.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: no requirement change; preserve source custody and bounded execution.
  - Depends on (added): none

## Impact

Synthetic batch/cycle verification only. No new permissions, model calls, storage schema or deployment.
