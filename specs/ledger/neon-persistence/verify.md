# Verification: Neon Ledger Persistence

### Requirement: Ledger and Mastra storage are separate

- **THEN** ledger objects are created only under `dw_ledger`
- **AND** no ledger table is created under `dw_issue23`

### Requirement: Runtime writes are append-only

- **THEN** `dw_runtime_issue23` has `SELECT` and `INSERT` only for ledger tables
- **AND** has no `CREATE`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` ledger authority

### Requirement: Durable rows preserve derived authority

- **THEN** proposal and supersession rows enforce `authority = DERIVED_ONLY`

### Requirement: Supersession references real proposal records

- **THEN** both supersession endpoints use foreign keys to `proposal_records(record_id)`
- **AND** self-supersession is rejected

### Requirement: Session Search remains a read interface, not the ledger owner

- **THEN** future Session Search access uses a bounded read seam
- **AND** Session Search receives no Dreaming Worker runtime database credential
- **AND** derived ledger results remain distinguishable from source/shard search hits
