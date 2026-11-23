# Verification: PostgreSQL Ledger Storage Adapter

### Requirement: Writes preserve append-only validation

- **WHEN** an event is appended
- **THEN** current persisted history is read under the transaction lock
- **AND** the existing ledger validator accepts the candidate before INSERT
- **AND** SQL values are parameterized

### Requirement: Failed writes leave no partial event

- **WHEN** validation or INSERT fails
- **THEN** the transaction rolls back
- **AND** the database client closes

### Requirement: Read order is exact across event types

- **THEN** both ledger tables use one shared `event_seq`
- **AND** reads return events in ascending global event sequence

### Requirement: Database rows are not automatically trusted

- **WHEN** a stored row has invalid content-addressed identity or violates ledger graph rules
- **THEN** read fails closed through the existing ledger validator

### Requirement: Hosted PostgreSQL validates real behavior

- **THEN** GitHub-hosted PostgreSQL 17 applies the migration twice
- **AND** verifies least-privilege runtime grants
- **AND** exercises the real adapter using the runtime role
