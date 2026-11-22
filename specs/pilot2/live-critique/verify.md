# Verification: Pilot 2 — Bounded Live Critique

### Requirement: Exactly one bounded call

#### Scenario: Critique succeeds

- **GIVEN** a valid frozen `CritiqueInput` and valid critique route
- **WHEN** live critique executes
- **THEN** exactly one provider request is made
- **AND** output tokens and timeout are bounded
- **AND** no retry, tool, memory, or canonical write occurs

### Requirement: Critique remains derived-only

#### Scenario: Model returns a valid artifact

- **WHEN** the artifact is accepted
- **THEN** authority is `DERIVED_ONLY`
- **AND** all proposal/evidence references are validated against the frozen input
- **AND** original Pilot 2 perspectives remain unchanged

### Requirement: Invalid model output fails explicitly

#### Scenario: Model returns free prose

- **THEN** outcome is `FAILED` with `CRITIQUE_JSON_INVALID`

#### Scenario: Model invents a proposal or evidence reference

- **THEN** outcome is `FAILED` with the corresponding deterministic critique reference failure

### Requirement: Transport failures stay visible

#### Scenario: Provider times out, returns empty final content, or exhausts output budget

- **THEN** those outcomes remain distinct typed failures
- **AND** no automatic retry occurs
