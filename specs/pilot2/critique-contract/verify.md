# Verification: Pilot 2 — Bounded Critique Contract

## Requirements

### Requirement: Frozen first-pass artifacts remain the source of critique references

#### Scenario: Pilot 2 has two valid perspectives

- **GIVEN** a `COMPLETE` Pilot 2 result
- **WHEN** critique input is built
- **THEN** both validated proposal sets are copied into critique input
- **AND** stable proposal fingerprints match the Pilot 2 comparison fingerprints
- **AND** source references and evidence hashes remain unchanged

### Requirement: Partial execution remains visible

#### Scenario: Exactly one Pilot 2 pass is valid

- **GIVEN** a `PARTIAL` Pilot 2 result
- **WHEN** critique input is built
- **THEN** the valid perspective is preserved
- **AND** the failed perspective and typed failure remain visible

### Requirement: No valid perspective means no critique

#### Scenario: Pilot 2 fails closed

- **GIVEN** no valid Pilot 2 perspective
- **WHEN** critique input is requested
- **THEN** critique input construction fails
- **AND** no critique work is implied

### Requirement: Critique cannot invent provenance

#### Scenario: Critique references a proposal that does not exist

- **WHEN** critique artifact validation runs
- **THEN** validation fails with `CRITIQUE_PROPOSAL_REF_REJECTED`

#### Scenario: Critique references evidence not carried by its referenced proposals

- **WHEN** critique artifact validation runs
- **THEN** validation fails with `CRITIQUE_EVIDENCE_REF_REJECTED`

### Requirement: Relation labels have bounded semantics

#### Scenario: Agreement or disagreement cites only one perspective

- **THEN** critique schema validation fails

#### Scenario: Disagreement or unresolved relation requests no further evidence

- **THEN** critique schema validation fails

### Requirement: Critique is derived only

#### Scenario: A critique artifact is accepted

- **THEN** its authority is exactly `DERIVED_ONLY`
- **AND** it does not replace the frozen Pilot 2 artifacts
