# Proposal: strict-critique-json

## Motivation

Issue #54: ensure the critique artifact cannot silently discard duplicate decoded keys.

## Current behaviour

The previous native design covered the core contract but the critique parser also has its own canonical specification link.

## Proposed solution

Apply the shared strict parser from strict-model-json to critique artifacts before existing validation; preserve the critique contract.

## Specs affected

### New specs

None.

### Modified specs

- `default:pilot2/critique-contract`: enforce the existing artifact contract at the JSON boundary.
  - Depends on (added): none

## Impact

Same narrow implementation as strict-model-json. No new inference or authority.

## Technical context

The core change already implements and tests this correction; this change records the additional canonical specification linkage required by the diff gate.

## Open questions

None.
