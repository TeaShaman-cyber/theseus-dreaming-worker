# Proposal: completion-only-recovery

## Motivation

Issue #65. An analysis can finish successfully while its database transaction fails. The current candidate returns the analysis but does not retain the reservation correlation needed to retry persistence.

## Current behaviour

PR66 verifies readback after commit, blocks repeat inference and retains an uncommitted candidate, but has no explicit completion-only recovery entrypoint.

## Proposed solution

Return a trusted-caller recovery envelope only for a complete candidate whose commit remains unknown. Explicitly recover by reading the exact completion first, then attempting at most one transaction with the same reservation token if absent. Do not invoke inference or acquire another reservation.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: explicit retained-candidate recovery.
  - Depends on (added): none

## Impact

Existing laboratory composition and tests only. No lease, scheduler, new service or source permission.

## Technical context

Dependent on PR66 exact candidate 1219958f13d557e1b52986bad589aa7eb1ba82e8. Reuse existing validation and PostgreSQL transaction/owner foreign key. Caller custody is required; the envelope is not authorization or proof of durable persistence.

## Open questions

Recovery when the candidate itself is lost remains unresolved; no automatic takeover.
