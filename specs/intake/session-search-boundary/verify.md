# Verification: Session Search Intake Boundary

## Requirements

### Requirement: Intake authority is explicit

#### Scenario: App OAuth is the only available credential

- **GIVEN** the only demonstrated read route is a human/App OAuth session
- **WHEN** unattended worker intake is considered
- **THEN** the route remains unauthorized for the worker
- **AND** no credential is copied into the worker runtime

### Requirement: Query retrieval is not treated as an accepted-source delta feed

#### Scenario: Search returns NO_SIGNAL

- **GIVEN** a bounded Session Search query returns no matching text
- **WHEN** the worker decides whether new accepted source material exists
- **THEN** the search miss is not accepted as proof that no new source material exists

### Requirement: Source authority and indexed projection remain separate

#### Scenario: A shard generation changes

- **GIVEN** a materialized shard receives a new generation identifier
- **WHEN** the worker evaluates source change
- **THEN** it does not infer that one new message or conversation was accepted solely from that generation change

### Requirement: A future delta reader preserves exact provenance

#### Scenario: Reader emits a candidate delta without stable source identity

- **GIVEN** a future reader returns text but no accepted-source identity or reproducible evidence reference
- **WHEN** the worker attempts to form an evidence packet
- **THEN** intake is rejected as insufficiently provenance-bearing

### Requirement: Recovery handoff candidate validation

#### Scenario: Exact trusted recovery candidate

- **GIVEN** a synthetic source candidate and independently expected predecessor and catalog
- **WHEN** the consumer validates its wire identity
- **THEN** the exact candidate is returned with unknown currentness and removals preserved
- **AND** no inference or checkpoint mutation occurs

#### Scenario: Inconsistent recovery candidate

- **GIVEN** invalid digest, membership, scope, catalog or placement
- **WHEN** the consumer validates the candidate
- **THEN** the candidate is rejected even if an inconsistent payload was rehashed

### Requirement: Checkpoint advances only after bounded success

#### Scenario: Evidence is read but provider analysis fails

- **GIVEN** a bounded delta was read
- **AND** required analysis fails before terminal success
- **WHEN** checkpoint persistence is considered
- **THEN** the checkpoint does not advance over the failed evidence

### Requirement: Checkpoint-aware bounded execution skips unchanged work

#### Scenario: Repeated stable work

- **GIVEN** a previously committed checkpoint for the same accepted source, analysis intent and evidence payload
- **WHEN** the packet ID changes but the work identity does not
- **THEN** no inference is invoked

#### Scenario: Intake or checkpoint state is uncertain

- **GIVEN** an unavailable checkpoint, malformed or ambiguous evidence, or no accepted new evidence
- **WHEN** execution is considered
- **THEN** no inference is invoked
- **AND** incomplete empty intake is not reported as proof of source absence

#### Scenario: Bounded execution completes or fails

- **GIVEN** admissible new work
- **WHEN** both independent passes complete with normal finish
- **THEN** a candidate checkpoint is returned without persistence
- **AND** partial, failed or completion-unknown results do not produce a candidate

### Requirement: Private-data egress is separately authorized

#### Scenario: Read access exists but provider approval does not

- **GIVEN** the worker can read private evidence
- **AND** no explicit provider/data-class egress authorization exists
- **WHEN** analysis is requested
- **THEN** no external model call is made

### Requirement: Least privilege is preferred over broad SQL

#### Scenario: One shard database is directly queryable

- **GIVEN** a credential can query one derived shard directly
- **WHEN** the worker reads that shard
- **THEN** the result is not described as federated or source-complete Session Search evidence

### Requirement: Intake failure remains visible

#### Scenario: Coverage is partial or currentness is unknown

- **GIVEN** the source/index state is partial, stale, or unknown
- **WHEN** evidence is prepared
- **THEN** that state survives into the evidence packet
- **AND** the worker does not turn it into an absence claim
