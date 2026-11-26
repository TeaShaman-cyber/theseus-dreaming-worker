# Proposal: strict-model-json

## Motivation

Issue #54 and research #120: JSON.parse silently overwrites duplicate decoded names; Biome upstream #13487 misses escaped aliases.

## Current behaviour

Proposal and critique parsers validate only after native JSON.parse has discarded duplicates.

## Proposed solution

Use one pinned ready-made strict JSON parser before existing schema and exact provenance validation. Reject ambiguity, never repair it.

## Specs affected

### New specs

None.

### Modified specs

- `default:worker/core-contract`: enforce existing untrusted-data and deterministic sufficiency requirements.
  - Depends on (added): none

## Impact

Model-artifact lexical boundary only. No source-reader, transport, authority, routing or inference changes.

## Technical context

Research #120 evaluated @prantlf/jsonlint 17.0.1 and pinned JSONTestSuite. Preserve public error taxonomy and valid artifact values.

## Open questions

Cloudflare bundled compatibility must be verified by existing QA.
