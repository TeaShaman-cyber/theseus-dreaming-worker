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

### Requirement: Verified selected session evidence

#### Scenario: Exact bounded reader pages

- **GIVEN** a synthetic selected session with verified source metadata and exact pinned pages
- **WHEN** the adapter validates the pages
- **THEN** it prepares the existing analysis input with unknown currentness and exact separate source lineage
- **AND** no external call or source checkpoint mutation occurs

#### Scenario: Changed custody or inconsistent retrieval

- **GIVEN** an unchanged scoped content identity with a different verified generation or source links
- **WHEN** the adapter prepares the same analysis intent
- **THEN** the existing work identity is unchanged
- **GIVEN** missing, changed, out-of-order or over-budget pages or conflicting source metadata
- **WHEN** the adapter validates them
- **THEN** no work is prepared

### Requirement: Exact source batch acknowledgement candidate

#### Scenario: Exact verified completions

- **GIVEN** the complete synthetic selected set with exact bounded evidence and independently verified work completions
- **WHEN** the receipt builder derives a candidate
- **THEN** it binds all source and completion identities without evidence text or checkpoint mutation

#### Scenario: Incomplete or inconsistent work

- **GIVEN** missing, duplicate, extra, removed, unusable or incomplete work
- **WHEN** the builder attempts preparation
- **THEN** it returns no acknowledgement candidate

### Requirement: Bounded synthetic source batch run

#### Scenario: Budgeted continuation and replay

- **GIVEN** an explicit predecessor and complete verified synthetic plan requiring more than one work
- **WHEN** the run exhausts its pass budget and is invoked again
- **THEN** the first invocation does not advance the checkpoint and the next reuses completed work
- **AND** full verified acknowledgement is returned only after all work completes
- **AND** exact replay performs zero inference

#### Scenario: Invalid or uncertain execution

- **GIVEN** invalid input, invalid routes, unconfirmed staging or incomplete work
- **WHEN** a batch run is requested
- **THEN** execution stops without acknowledging partial progress

#### Scenario: Zero-pass completion-only acknowledgement

- **GIVEN** an exact staged plan whose selected work completed durably before the source acknowledgement
- **WHEN** execution resumes with fewer than two remaining attempted passes
- **THEN** the existing verified acknowledgement may confirm the complete batch without reserving work or invoking inference
- **AND** missing completion leaves the checkpoint unchanged and uncertainty is not budget exhaustion

### Requirement: Bounded synthetic source acquisition

#### Scenario: Exact pinned read

- **GIVEN** a valid synthetic handoff and exact source indexes
- **WHEN** the injected transport returns bounded pinned pages
- **THEN** the complete verified batch is returned without inference or persistence

#### Scenario: Failed or excessive acquisition

- **GIVEN** invalid metadata, stale response, repeated cursor, unavailable transport, timeout or exhausted bounds
- **WHEN** acquisition is attempted
- **THEN** no batch ready for analysis is returned

### Requirement: Bounded synthetic source cycle

#### Scenario: Acquisition through durable completion

- **GIVEN** a trusted synthetic handoff, bounded transport and existing source store
- **WHEN** the cycle is invoked with a limited pass budget, continued and replayed
- **THEN** complete admission precedes execution, only remaining work invokes inference, and the acknowledged receipt is independently readable

#### Scenario: Explicit stopped cycle

- **GIVEN** a rejected handoff or policy, incomplete acquisition, empty selection or unresolved removal
- **WHEN** the cycle is invoked
- **THEN** it returns an explicit stop without store access or inference and without advancing the source checkpoint
- **AND** a validated empty selection or removal retains the candidate identity and unknown currentness

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
