# Verification: Neon Ledger Persistence

## Requirements

### Requirement: Ledger and Mastra storage are separate

#### Scenario: Ledger schema is inspected

- **THEN** ledger objects are created only under `dw_ledger`
- **AND** no ledger table is created under `dw_issue23`

### Requirement: Runtime writes are append-only

#### Scenario: Runtime role grants are inspected

- **THEN** `dw_runtime_issue23` has `SELECT` and `INSERT` only for ledger tables
- **AND** has no `CREATE`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` ledger authority

### Requirement: Durable rows preserve derived authority

#### Scenario: Ledger row authority is checked

- **THEN** proposal and supersession rows enforce `authority = DERIVED_ONLY`

### Requirement: Supersession references real proposal records

#### Scenario: Supersession constraints are checked

- **THEN** both supersession endpoints use foreign keys to `proposal_records(record_id)`
- **AND** self-supersession is rejected

### Requirement: Session Search remains a read interface, not the ledger owner

#### Scenario: Future read seam is reviewed

- **THEN** future Session Search access uses a bounded read seam
- **AND** Session Search receives no Dreaming Worker runtime database credential
- **AND** derived ledger results remain distinguishable from source/shard search hits
