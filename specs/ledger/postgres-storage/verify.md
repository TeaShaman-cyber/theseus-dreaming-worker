# Verification: PostgreSQL Ledger Storage Adapter

## Requirements

### Requirement: Writes preserve append-only validation

#### Scenario: Append an event

- **WHEN** an event is appended
- **THEN** current persisted history is read under the transaction lock
- **AND** the existing ledger validator accepts the candidate before INSERT
- **AND** SQL values are parameterized

### Requirement: Failed writes leave no partial event

#### Scenario: Validation or insert fails

- **WHEN** validation or INSERT fails
- **THEN** the transaction rolls back
- **AND** the database client closes

### Requirement: Read order is exact across event types

#### Scenario: Read mixed events

- **THEN** both ledger tables use one shared `event_seq`
- **AND** reads return events in ascending global event sequence

### Requirement: Database rows are not automatically trusted

#### Scenario: Read invalid persisted data

- **WHEN** a stored row has invalid content-addressed identity or violates ledger graph rules
- **THEN** read fails closed through the existing ledger validator

### Requirement: Hosted PostgreSQL validates real behavior

#### Scenario: Run the hosted database contract

- **THEN** GitHub-hosted PostgreSQL 18 applies the migration twice
- **AND** verifies least-privilege runtime grants
- **AND** exercises the real adapter using the runtime role

### Requirement: Connection and transaction boundaries are independently verified

#### Scenario: Construct the default client

- **GIVEN** an explicitly supplied synthetic connection string
- **WHEN** the default adapter client is created
- **THEN** its actual connection parameters match the supplied string without contacting a live service

#### Scenario: Transaction order and invalid rows

- **WHEN** append executes or a required persisted field is null
- **THEN** BEGIN precedes lock, read and INSERT, and COMMIT follows INSERT
- **AND** a null required field reports the offending field and fails closed

### Requirement: Work reservation and atomic completion

#### Scenario: Concurrent bounded execution and replay

- **GIVEN** two callers with the same stable admitted work
- **WHEN** they use the durable execution path
- **THEN** only one invokes the two bounded adapters
- **AND** subsequent replay makes zero calls and verifies the completed record membership

#### Scenario: Incomplete analysis or uncertain storage

- **GIVEN** an unavailable reservation, incomplete analysis or failed transaction
- **WHEN** the execution returns
- **THEN** no unverified completion is asserted and no inference retry occurs
- **AND** available analysis and any uncommitted candidate remain distinguishable from verified completion

#### Scenario: Durable projection readback

- **WHEN** a completion is read from PostgreSQL
- **THEN** the ordered derived records and observed provenance reproduce the stored projection fingerprint
- **AND** a different work version retains distinct record identities
