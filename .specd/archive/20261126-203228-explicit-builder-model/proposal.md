# Proposal: explicit-builder-model

## Motivation

Issue #87: the development Builder silently selects Kimi when no model was configured.

## Current behaviour

A hardcoded fallback and sample environment select a provider model without explicit intent.

## Proposed solution

Require explicit nonblank BUILDER_MODEL. Disable only the model-backed Builder when unset. Keep Studio, Editor, workflows and stored agents.

## Specs affected

### New specs

None.

### Modified specs

- `default:worker/core-contract`: explicit model selection in the development surface.
  - Depends on (added): none

## Impact

Development configuration only. No production route or inference changes.

## Technical context

No default substitute model; no inference during QA.

## Open questions

None.
