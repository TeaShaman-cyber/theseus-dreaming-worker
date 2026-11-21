# Verification: Dreaming Worker Core Contract

## Requirements

### Requirement: Evidence remains separate from interpretation

#### Scenario: Model agreement does not create source truth

- **GIVEN** two models produce the same hypothesis from one bounded evidence packet
- **WHEN** the worker records their outputs
- **THEN** the proposal remains derived model output
- **AND** agreement alone does not promote it to source truth or canonical memory

### Requirement: Every derived proposal is typed and provenance-bearing

#### Scenario: A proposal invents a source reference

- **GIVEN** a model output whose source reference or evidence hash is absent from the input packet
- **WHEN** deterministic proposal validation runs
- **THEN** the proposal is rejected

### Requirement: No accepted evidence means no model work

#### Scenario: Evidence gate returns NO_DATA

- **GIVEN** no accepted new evidence
- **WHEN** the worker is invoked
- **THEN** external model calls equal zero

### Requirement: Independent first passes remain independent

#### Scenario: Two model families analyze one packet

- **GIVEN** one accepted evidence packet and two approved independent model families
- **WHEN** both first passes run
- **THEN** both receive the same evidence-packet fingerprint
- **AND** neither first pass receives the other pass's output

### Requirement: Disagreement is preserved

#### Scenario: Independent models contradict each other

- **GIVEN** two valid first-pass proposal sets with incompatible hypotheses
- **WHEN** the worker constructs a comparison artifact
- **THEN** both original proposals remain present
- **AND** the contradiction is represented explicitly
- **AND** no majority-vote truth is produced

### Requirement: Model output is untrusted data

#### Scenario: Model prose claims false runtime facts

- **GIVEN** a model claims that zero model calls or zero tools were used
- **WHEN** the worker constructs its runtime receipt
- **THEN** runtime facts come from controlled invocation/readback rather than model prose

### Requirement: Failure and cost boundaries are explicit

#### Scenario: One provider fails during a multi-model run

- **GIVEN** two planned independent passes
- **AND** one pass returns a timeout, 429, credential failure, or malformed output
- **WHEN** the run terminates
- **THEN** the failure remains visible
- **AND** the run is not reported as a complete two-perspective result

### Requirement: Runtime, persistence, and authority remain separable

#### Scenario: Runtime backend changes

- **GIVEN** the same versioned evidence and analysis contracts
- **WHEN** the bounded workflow moves between authorized runners
- **THEN** proposal semantics and authority boundaries remain unchanged

### Requirement: Canonical promotion is outside the worker

#### Scenario: A valid hypothesis is produced

- **GIVEN** a schema-valid evidence-linked hypothesis
- **WHEN** the worker completes
- **THEN** no canonical memory, user preference, project policy, or external publication is changed automatically
