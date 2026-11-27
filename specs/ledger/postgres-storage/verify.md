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

### Requirement: Explicit completion-only recovery

#### Scenario: Retained complete candidate

- **GIVEN** a complete retained candidate and the original reservation
- **WHEN** recovery finds no durable completion
- **THEN** at most one completion transaction is attempted and independently read back
- **AND** no inference or new reservation occurs

#### Scenario: Existing or uncertain completion

- **WHEN** recovery reads an existing completion or the read is unavailable
- **THEN** an exact matching completion is returned without writing, otherwise state remains unknown
- **AND** malformed candidate and wrong reservation correlation do not create a completion

### Requirement: Bounded durable attempt journal

#### Scenario: Recover only the missing perspective

- **GIVEN** a confirmed journal with one validated slot and one known failed attempt
- **WHEN** the store is reconstructed and the exact journal is read
- **THEN** the validated slot and attempt history remain immutable
- **AND** only a new distinct route may fill the missing slot within the remaining budget

#### Scenario: Concurrent or ambiguous admission

- **GIVEN** two callers contend on the same journal tip or one outcome is unknown
- **WHEN** attempt admission is requested
- **THEN** at most one start is confirmed and unresolved state blocks further starts
- **AND** no completion or source acknowledgement follows merely from a journal entry

### Requirement: Explicit resumable pooled execution

#### Scenario: Known failure and restart

- **GIVEN** a validated first slot and an observed rate-limit failure for a second route
- **WHEN** execution restarts with a remaining permitted route and invocation budget
- **THEN** the frozen first slot is not invoked again
- **AND** the exact two-slot projection commits through the existing completion recovery
- **AND** completed replay performs zero inference

#### Scenario: Unknown or unconfirmed start

- **GIVEN** a pending or unknown attempt or ambiguous storage acknowledgement
- **WHEN** pooled execution is invoked again
- **THEN** it does not dispatch another inference
- **AND** it does not advance source progress

### Requirement: Pooled completion custody

#### Scenario: Ordinary or incomplete pooled completion

- **GIVEN** a pooled work journal with a pending attempt and no validated perspectives
- **WHEN** an ordinary or explicit pooled completion is attempted using a structurally valid candidate
- **THEN** no derived record or completion is inserted
- **AND** the original journal remains unresolved

#### Scenario: Exact complete pooled projection

- **GIVEN** two validated distinct perspectives in an exact journal
- **WHEN** completion is attempted under the original reservation and input
- **THEN** only the recomputed exact projection may commit
- **AND** wrong owner, input or projection is rejected before insertion

#### Scenario: Shared projection builder trace

- **GIVEN** the exact committed pooled completion implementation
- **WHEN** the repository's SpecD diff gate runs
- **THEN** the native design covers the shared projection builder and both its executor and storage callers

### Requirement: Durable source batch acknowledgement

#### Scenario: Explicit root and exact successor

- **GIVEN** an explicitly initialized trusted synthetic predecessor and all verified completions
- **WHEN** the source store acknowledges the batch
- **THEN** exactly one successor is stored and independently read back
- **AND** replay requires no new inference

#### Scenario: Incomplete or conflicting source checkpoint

- **GIVEN** missing predecessor, incompatible membership, incomplete work or a competing successor
- **WHEN** acknowledgement is attempted
- **THEN** the chain does not advance incorrectly
- **AND** ambiguous commit is resolved only by exact readback

### Requirement: Pending source plan custody

#### Scenario: Recovered pending witness

- **GIVEN** an exact synthetic selected batch and existing source predecessor
- **WHEN** staging succeeds and the executor restarts
- **THEN** exact metadata and work/packet identities are independently recovered
- **AND** source acknowledgement remains unchanged

#### Scenario: New source witness or invalid predecessor

- **GIVEN** a rederived source witness for the same content under an unadvanced predecessor
- **WHEN** staging succeeds
- **THEN** both witnesses remain distinct and the same work identity is retained
- **GIVEN** an absent or advanced predecessor, or inconsistent stored plan
- **WHEN** staging or readback is attempted
- **THEN** no new plan is accepted or corrupt plan returned

### Requirement: Staged source work admission

#### Scenario: Missing or exact staged plan

- **GIVEN** a verified synthetic selected work without a staged plan
- **WHEN** source-specific execution is requested
- **THEN** no reservation or inference occurs
- **GIVEN** the exact staged plan and unadvanced predecessor
- **WHEN** execution is requested
- **THEN** one reservation is bound to the original plan before inference
- **AND** replay does not repeat inference or change the original plan

### Requirement: Same-plan pooled source admission

#### Scenario: Missing or changed source custody

- **GIVEN** missing staged plan, unbound reservation or a different original plan
- **WHEN** pooled selected work is requested
- **THEN** no model call or new origin follows
- **AND** an existing journal is not adopted

#### Scenario: Partial source work and restart

- **GIVEN** an exact staged synthetic plan and one validated perspective followed by known failure
- **WHEN** the same plan is resumed
- **THEN** only the missing slot is executed
- **AND** the original plan remains immutable and the source checkpoint does not advance until every selected work completes
- **AND** exact completed replay uses zero inference

### Requirement: Source acknowledgement retains original plan

#### Scenario: Distinct original and current plans

- **GIVEN** a verified completion bound to its original staged plan and an equivalent later staged witness
- **WHEN** the batch is acknowledged
- **THEN** the receipt preserves both identities and exact readback
- **AND** an unbound generic completion cannot advance the chain
