# Proposal: source-receipt-origin

## Motivation

Issue #65: acknowledged work must retain its original durable plan, not merely its packet ID.

## Current behaviour

Source-specific reservation binds an original plan but acknowledgement can accept generic completions.

## Proposed solution

Require exact staged current plan and independently verified original plan binding for each completion. Store both in a versioned durable receipt.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: exact receipt origin binding.
  - Depends on (added): none

## Impact

No new schema, source permissions or inference stage.

## Technical context

Reuse the existing locked transaction, source work origins and verified completion read.

## Open questions

Real source authorization and retention, empty/removal disposition and replan policy remain separate.
