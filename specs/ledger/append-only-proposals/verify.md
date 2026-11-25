# Verification: Append-only Proposal Ledger

## Requirements

### Requirement: History is append-only

#### Scenario: A newer proposal supersedes an older one

- **GIVEN** two existing immutable proposal records
- **WHEN** a valid supersession event is appended
- **THEN** both proposal records remain present unchanged
- **AND** the materialized view marks only the older record as `SUPERSEDED`

### Requirement: Identity is content-addressed

#### Scenario: Event content or event ID is forged

- **WHEN** append revalidates the event
- **THEN** it fails with `LEDGER_EVENT_ID_MISMATCH`

### Requirement: Supersession graph fails closed

#### Scenario: A supersession references a missing record

- **THEN** append fails with `LEDGER_SUPERSESSION_REF_MISSING`

#### Scenario: A supersession points to itself

- **THEN** creation/append fails with `LEDGER_SELF_SUPERSESSION`

#### Scenario: A new edge would create a cycle

- **THEN** append fails with `LEDGER_SUPERSESSION_CYCLE`

### Requirement: Hypothesis semantics are preserved

#### Scenario: A HYPOTHESIS proposal is recorded

- **THEN** its falsifier and required evidence remain exact
- **AND** authority remains `DERIVED_ONLY`

#### Scenario: Proposal fingerprint does not match embedded Proposal v1 payload

- **THEN** append fails with `LEDGER_PROPOSAL_FINGERPRINT_MISMATCH`
