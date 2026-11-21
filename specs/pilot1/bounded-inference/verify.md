# Verification: Pilot 1 Bounded Inference

## Requirements

### Requirement: External inference is scope-gated

#### Scenario: Unapproved scope is rejected before inference

- **GIVEN** an evidence packet whose requested scope is not `SYNTHETIC_FIXTURE` or `PUBLICATION_SAFE`
- **WHEN** Pilot 1 validates the request
- **THEN** it rejects the request
- **AND** the inference callback is not invoked

### Requirement: No accepted evidence means no model call

#### Scenario: Pilot 0 reports NO_DATA

- **GIVEN** Pilot 0 accepts no new evidence
- **WHEN** Pilot 1 runs
- **THEN** the outcome is `NO_DATA`
- **AND** external model calls equal zero

### Requirement: A valid Pilot 1 run is bounded to one model inference

#### Scenario: Trace reports more than one inference

- **GIVEN** a synthetically safe Pilot 1 request
- **WHEN** runtime trace evidence reports more than one model inference
- **THEN** Pilot 1 rejects the run as a policy violation

### Requirement: Pilot 1 performs no tool or memory operations

#### Scenario: Runtime trace reports a tool or memory operation

- **GIVEN** a synthetically safe Pilot 1 request
- **WHEN** runtime trace evidence reports a real tool call or memory operation
- **THEN** Pilot 1 rejects the run as a policy violation

### Requirement: Runtime receipt authority remains outside model prose

#### Scenario: Model prose lies about runtime counts

- **GIVEN** model output that claims an incorrect external model call count
- **WHEN** the outer runner constructs the receipt
- **THEN** the receipt reflects the actual controlled invocation/readback
- **AND** the model-authored count does not control receipt fields
