# Pilot 1 Bounded Inference

## Purpose

Pilot 1 may ask one external model to propose typed hypotheses only after the outer runner has accepted explicitly safe evidence. The model is not an authority for execution facts, tool use, memory use, or canonical state.

## Requirements

### Requirement: External inference is scope-gated

The outer runner MUST reject any request whose scope is not `SYNTHETIC_FIXTURE` or `PUBLICATION_SAFE` before invoking the model.

### Requirement: No accepted evidence means no model call

When Pilot 0 returns `NO_DATA`, Pilot 1 MUST return without invoking external inference.

### Requirement: A valid Pilot 1 run is bounded to one model inference

A valid proposed run MUST contain exactly one model inference. Observed extra model inferences MUST fail closed.

### Requirement: Pilot 1 performs no tool or memory operations

Observed real tool calls or memory operations MUST fail closed. Workspace bookkeeping MUST remain distinguishable from real tool use.

### Requirement: Runtime receipt authority remains outside model prose

Model output MAY propose typed `FACT`, `INFERENCE`, `HYPOTHESIS`, and `UNKNOWN` items, but MUST NOT determine runtime receipt facts. The deterministic outer runner MUST construct execution counts and receipt fields from controlled execution/readback.

## Constraints

- Model fluency or self-report MUST NOT upgrade a hypothesis into a runtime fact.
- Private or unclassified evidence MUST NOT reach external inference in this phase.
- Canonical memory/preferences MUST NOT be written by Pilot 1.
- Runtime evidence, semantic proposal validity, and repository desired state remain separate claims.

## Spec Dependencies

_none_
