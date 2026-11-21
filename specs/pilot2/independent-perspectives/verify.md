# Verification: Pilot 2 — Independent Model Perspectives

## Requirements

### Requirement: The two first passes are genuinely independent

#### Scenario: Distinct model families are accepted

- **GIVEN** two approved routes with different model-family identities
- **WHEN** Pilot 2 validates the plan
- **THEN** the independent two-pass run may proceed

#### Scenario: Same model family through two routes is rejected

- **GIVEN** two routes that resolve to the same model family
- **WHEN** Pilot 2 validates independence
- **THEN** outcome is `FAIL_CLOSED`
- **AND** neither provider pass is invoked

### Requirement: First-pass isolation is blind

#### Scenario: Passes run before comparison

- **GIVEN** one evidence packet and two approved independent routes
- **WHEN** Pass A and Pass B execute
- **THEN** neither first-pass input contains the other pass's proposal output
- **AND** comparison begins only after both first-pass records are frozen or one pass has terminated with a typed failure

### Requirement: Both passes see the same primary evidence

#### Scenario: Exact evidence parity

- **GIVEN** one accepted evidence packet
- **WHEN** both first passes are invoked
- **THEN** both invocations record the same evidence fingerprint
- **AND** the same request/task fingerprint
- **AND** the same coverage/currentness state

### Requirement: Each pass uses the Pilot 1 proposal contract

#### Scenario: Pass B invents a source reference

- **GIVEN** Pass A returns valid proposals
- **AND** Pass B returns a proposal with an invented source reference or wrong evidence hash
- **WHEN** Pilot 2 validates the passes
- **THEN** Pass B becomes a typed invalid-output failure
- **AND** its proposal is not admitted as a valid perspective

### Requirement: Terminal state distinguishes absence from analysis failure

#### Scenario: Both providers fail after evidence was accepted

- **GIVEN** Pilot 0 accepted evidence
- **AND** both configured-distinct first passes terminate with typed failures
- **WHEN** Pilot 2 terminates
- **THEN** outcome is `FAIL_CLOSED`
- **AND** outcome is not `NO_DATA`
- **AND** both typed failures remain visible

#### Scenario: Configured independence is not established

- **GIVEN** Pilot 0 accepted evidence
- **AND** both routes declare the same model family
- **WHEN** Pilot 2 validates the route plan
- **THEN** outcome is `FAIL_CLOSED`
- **AND** external model calls equal zero

### Requirement: Pass failure and receipt uncertainty stay explicit

#### Scenario: Provider times out after inference was invoked

- **GIVEN** one pass succeeds
- **AND** the other invoked pass terminates with a timeout whose provider-side completion state is unknown
- **WHEN** Pilot 2 constructs the receipt
- **THEN** the failed pass is `TIMEOUT_UNKNOWN_PROVIDER_STATE`
- **AND** the successful pass contributes to `confirmedExternalModelCalls`
- **AND** the failed invoked pass contributes to `unresolvedExternalCallAttempts`

#### Scenario: Output budget is exhausted before final content

- **GIVEN** a provider returns empty final content with finish reason `length`
- **WHEN** Pilot 2 normalizes the pass
- **THEN** the pass failure is `OUTPUT_BUDGET_EXHAUSTED`

#### Scenario: Transport rejects structured JSON generation

- **GIVEN** a provider adapter reports `json_validate_failed`
- **WHEN** Pilot 2 normalizes the pass
- **THEN** the pass failure is `JSON_VALIDATE_FAILED`

#### Scenario: Returned provider metadata survives later validation failure

- **GIVEN** a provider returns observed provider/model metadata and model output
- **AND** the returned output later fails JSON, schema, provenance, or policy validation
- **WHEN** Pilot 2 records the failed pass
- **THEN** configured route identity remains visible
- **AND** observed provider/model metadata remains separately visible
- **AND** the failed pass does not contribute to `confirmedExternalModelCalls`

### Requirement: Partial provider failure remains visible

#### Scenario: One provider times out

- **GIVEN** Pass A succeeds
- **AND** Pass B times out
- **WHEN** Pilot 2 terminates
- **THEN** outcome is `PARTIAL`
- **AND** Pass A remains available
- **AND** Pass B timeout remains visible
- **AND** no substitute provider is silently invoked

### Requirement: Comparison preserves dissent

#### Scenario: Models produce different hypotheses

- **GIVEN** two valid first-pass proposal sets with one exact structured match and pass-specific proposals
- **WHEN** deterministic comparison is constructed
- **THEN** both original proposal sets remain intact
- **AND** the exact match is represented by a shared proposal fingerprint
- **AND** pass-specific proposals remain separately fingerprinted
- **AND** semantic relation is `UNRESOLVED_WITHOUT_CRITIQUE`
- **AND** no consensus truth classification is emitted

### Requirement: Critique is optional and later

#### Scenario: First implementation has no critic

- **GIVEN** two valid first-pass outputs
- **WHEN** Pilot 2 completes without a critique model
- **THEN** the result is still valid
- **AND** the comparison artifact remains descriptive rather than authoritative

### Requirement: Pilot 2 remains synthetic/publication-safe

#### Scenario: Private scope is requested

- **GIVEN** a request outside `SYNTHETIC_FIXTURE` and `PUBLICATION_SAFE`
- **WHEN** Pilot 2 validates the request
- **THEN** no provider call is made

### Requirement: No-data still short-circuits before inference

#### Scenario: Pilot 0 returns NO_DATA

- **GIVEN** no accepted new evidence
- **WHEN** Pilot 2 runs
- **THEN** external model calls equal zero
- **AND** outcome is `NO_DATA`
