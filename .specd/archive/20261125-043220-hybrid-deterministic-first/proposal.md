# Proposal: hybrid-deterministic-first

## Motivation

The user reaffirmed that Dreaming Worker is a hybrid system, not a model-selection project. Issue #54 experiments showed that three Clairic extraction cases could also be solved by ordinary parsing, but the experimental plan had not required a deterministic baseline.

## Current behaviour

Pilot 0, proposal validation, exact comparison and ledger identity already use deterministic code. The recovery benchmark has an optional model candidate path. Core requirements do not explicitly require deterministic sufficiency or a comparison against software before adding a model stage. PR #60 enforces structural SpecD validation but does not prove semantic conformance.

## Proposed solution

Make the existing hybrid intent a named core requirement and observable verification scenarios. Require a requirement-linked baseline and explicit residual semantic task before accepting an additional inference stage. Preserve existing independent reasoners and bounded experiments; do not add a universal natural-language parser or automatic recovery model.

## Specs affected

### New specs

None.

### Modified specs

- `default:worker/core-contract`: explicit deterministic-first and incremental-value requirement.
  - Depends on (added): none

## Impact

Core goal contract, agent development/review instructions and the existing QA traceability route. No runtime behavior, permission, storage, provider or budget changes in this pilot. The actual recovery implementation remains coordinated by #54; existing PR #59 is not modified.

## Technical context

Issue #52 records the SpecD adoption gap; #54 records the comparison methodology correction. The user explicitly requested mandatory QA and semantic lifecycle. PR #60 introduced locked SpecD 0.2.0 and mandatory upstream validation. Use the native lifecycle rather than reconstructing fake history.

## Open questions

None blocking this requirement-only pilot. The exact parser and residual inference policy for future recovery work remain #54 research questions, not decided here.
