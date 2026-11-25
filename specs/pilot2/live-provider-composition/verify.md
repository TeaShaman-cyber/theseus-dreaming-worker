# Verification: Pilot 2 — Live Provider Composition

## Requirements

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

#### Scenario: Adapter returns no usable final content

- **GIVEN** the live provider adapter reports `EMPTY_FINAL_CONTENT` or `OUTPUT_BUDGET_EXHAUSTED`
- **WHEN** live composition hands the failed pass to Pilot 2
- **THEN** the corresponding Pilot 2 failure code is preserved
- **AND** the pass does not degrade to generic `INFERENCE_FAILED`

### Requirement: Model-facing schema has one source of truth

#### Scenario: A live provider receives the Proposal v1 contract

- **GIVEN** deterministic validation uses the canonical Zod `proposalSetSchema`
- **WHEN** the provider adapter builds the system message
- **THEN** the model-facing JSON Schema is generated from that same validator
- **AND** handwritten field-type duplication is not the authority

### Requirement: Transport options remain transport-only

#### Scenario: JSON-object mode or bearer authentication is configured

- **GIVEN** an explicit route requests JSON-object mode or supplies a runtime bearer credential
- **WHEN** live composition delegates to the generic provider adapter
- **THEN** those options are transmitted only at the transport boundary
- **AND** Pilot 2 outcome, validation, comparison, and authority semantics remain unchanged
