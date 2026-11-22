# Verification: Pilot 2 — Live Provider Composition

### Requirement: Live composition preserves the pure Pilot 2 contract

#### Scenario: Two explicit configured-distinct routes are composed

- **GIVEN** a valid synthetic/publication-safe request
- **AND** two explicit live route descriptors
- **WHEN** live composition runs
- **THEN** both adapters are passed to the existing Pilot 2 orchestrator
- **AND** Pilot 2 remains the owner of terminal outcome and comparison semantics

### Requirement: Output work is explicitly bounded

#### Scenario: A route omits its output-token bound

- **GIVEN** a live route without a positive integer `maxOutputTokens`
- **WHEN** live composition validates its route descriptors
- **THEN** the request is rejected
- **AND** no provider call occurs

#### Scenario: A route has a valid output-token bound

- **GIVEN** `maxOutputTokens` is configured
- **WHEN** the OpenAI-compatible adapter sends the request
- **THEN** the provider request carries the corresponding `max_tokens` value

### Requirement: Invalid live configuration fails before network work

#### Scenario: Same-family routes are configured

- **GIVEN** two otherwise valid live routes with the same model-family identity
- **WHEN** live composition delegates to Pilot 2
- **THEN** the outcome is `FAIL_CLOSED`
- **AND** no provider call occurs

### Requirement: Runtime/provider evidence stays separate

#### Scenario: Transport responds but the proposal artifact is invalid

- **GIVEN** a provider returns an HTTP-success response
- **AND** the returned model content does not satisfy Proposal v1
- **WHEN** Pilot 2 validates the pass
- **THEN** transport evidence may record the response
- **AND** the analytical pass remains a typed failure

### Requirement: Scope does not widen

#### Scenario: Live composition executes

- **GIVEN** the bounded live composition path
- **WHEN** it runs
- **THEN** it adds no tools, memory, canonical writes, private Session Search intake, scheduler, critique, or publication authority
