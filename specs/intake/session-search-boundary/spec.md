# Session Search Intake Boundary

## Purpose

This specification defines what must be true before Dreaming Worker may consume real unattended Session Search history.

It intentionally does not authorize that access.

The current Session Search query surface is useful evidence retrieval, but it is not proven to be a complete accepted-source delta feed for a scheduled dreaming worker.

## Current Verified Boundary

Current architecture evidence establishes:

- accepted artifacts and accepted-set identity exist upstream;
- Session Search indexed shards are derived projections rather than source authority;
- the router exposes authenticated bounded search;
- search preserves shard/generation provenance and partial coverage semantics;
- query search does not by itself enumerate every newly accepted artifact since a worker checkpoint;
- a changed shard generation is not equivalent to one new conversation or message;
- no host-independent, least-privilege unattended accepted-source delta reader has yet been verified for this worker.

Therefore real unattended intake remains `DEFERRED / UNKNOWN`. The synthetic consumer boundary now verifies source handoffs, bounded selected-session pages and exact batch receipts; #77 verified reuse across a changed generation in hosted PostgreSQL 18. These checks are not evidence of an unattended source reader or private-data authority.

## Requirements

### Requirement: Intake authority is explicit

The worker MUST consume only evidence from an explicitly authorized read surface.

A ChatGPT App OAuth session, operator bearer token, broad database credential, or convenient existing integration MUST NOT be silently reused as worker identity.

### Requirement: Query retrieval is not treated as an accepted-source delta feed

The existing Session Search query API MAY support bounded search tasks.

It MUST NOT be represented as a complete stream of newly accepted history unless an independently verified contract establishes that behavior.

A lexical search miss MUST NOT mean no new accepted source material exists.

### Requirement: Source authority and indexed projection remain separate

Accepted source membership, normalized source evidence, and Session Search materialized/indexed generations are separate claims.

A READY generation proves a serving projection is ready. It does not by itself prove source completeness or enumerate newly accepted artifacts.

A generation-ID change MUST NOT be treated as proof that a new message exists in that shard.

### Requirement: A future delta reader preserves exact provenance

A future unattended reader MUST provide enough information to construct a stable evidence packet with:

- source/accepted-set identity;
- exact artifact/message/session references as applicable;
- evidence hashes;
- shard/generation provenance when indexed evidence is used;
- explicit coverage/currentness state;
- explicit gap/partial state;
- an immutable or reproducible checkpoint identity.

### Requirement: Recovery handoff candidate validation

Before using a trusted source recovery candidate, the consumer MUST strictly validate its version, canonical digest, both membership receipts, append-only membership, expected previous snapshot, explicit scope/provider, and exact independently supplied complete catalog vector. Selected and removed session identities MUST be ordered, unique and disjoint; each placement MUST match its provider, shard, generation and source manifest identity.

Decoding MUST preserve unknown source currentness and removal obligations, and MUST NOT create evidence text, authorize access, invoke inference or advance a checkpoint. The caller MUST establish source custody and catalog observation independently. A valid digest is not authentication.

### Requirement: Verified selected session evidence

For a synthetic recovery candidate, the adapter MUST bind trusted source metadata and every retrieved searchable message to one selected session, exact accepted membership, shard and generation. It MUST enforce explicit page and character limits, exact ordered message metadata, uninterrupted offsets, final page and complete message text digests. All source references MUST belong to the accepted membership. Inconsistent, truncated or over-budget retrieval MUST NOT prepare work.

The adapter MUST preserve partial/unknown coverage and exact source lineage separately from the stable scoped content-dependent work identity. Blank messages MUST be accounted for even if not passed to the model. Empty usable evidence MUST NOT invoke inference or advance a checkpoint. A changed generation or archive link alone MUST NOT change the work identity. Decoding trusted inputs is not authentication, authority, durable completion or batch acknowledgement.

### Requirement: Exact source batch acknowledgement candidate

For synthetic recovery the receipt builder MUST derive every work identity from the exact selected session set and verified bounded pages under the same trusted handoff and analysis intent. Missing, duplicate, extra, removed or unusable selections MUST NOT yield an acknowledgement candidate. Every derived work MUST have a verified durable completion whose proposal references match admitted evidence. Unavailable, corrupt or missing completion MUST NOT advance the source checkpoint.

The receipt MUST bind the expected predecessor, full source handoff, analysis intent, selected work and completion fingerprints, and exact current source witness. Original inference packet identity MUST remain distinct from a later equivalent source witness. The candidate MUST contain no evidence text and MUST NOT invoke inference, write storage or authorize access. A candidate is not durable acknowledgement.

### Requirement: Bounded synthetic source batch run

A synthetic batch run MUST derive the complete verified plan and require explicit bounded pass budget and valid independent routes before any work reservation. It MUST use the existing staged source execution and verified acknowledgement primitives. No implicit root initialization or automatic retry/takeover is permitted.

The run MUST stop on uncertain or incomplete work and MUST NOT acknowledge a partial batch. Before a possible new two-pass work it MUST have at least two remaining attempted-pass budget units. Already completed work consumes no inference budget. Exact already acknowledged replay MUST perform no inference. Returned summaries MUST distinguish verified acknowledgement, budget exhaustion, conflict and uncertainty without retaining evidence bodies or treating unknown currentness as absence.

### Requirement: Bounded synthetic source acquisition

The synthetic acquisition adapter MUST validate the exact selected set and source indexes before requesting pages. It MUST pin each read to the selected session, shard and generation, and only follow a nonrepeated cursor bound to that exact read position. It MUST bound request count, response bytes per page and in aggregate, character and message admission, and each request deadline. Failed, incomplete or inconsistent acquisition MUST NOT return a batch ready for analysis.

The adapter MUST use injected explicitly supplied transport; no default network credential, real history access or implicit fallback is permitted. Complete acquired pages MUST pass the existing verified batch admission. The adapter MUST NOT reserve work, invoke inference or advance checkpoints.

### Requirement: Checkpoint advances only after bounded success

The worker checkpoint MUST NOT advance over evidence that was not successfully admitted and processed according to the current analysis contract.

A timestamp alone is insufficient as the durable checkpoint.

The checkpoint SHOULD bind accepted-source identity/fingerprint, analysis-contract version, and analysis scope.

### Requirement: Checkpoint-aware bounded execution skips unchanged work

A synthetic or publication-safe execution MUST establish an explicit available checkpoint read and a stable work identity before inference. The identity MUST bind accepted-source fingerprint, analysis version and task/scope, and the ordered evidence payload and coverage/currentness; a transient packet ID MUST NOT by itself create new work.

A matching previously committed checkpoint MUST result in zero inference calls. An unavailable checkpoint read, inconsistent or untrusted packet, or empty non-current/incomplete intake MUST NOT be treated as proof of new or absent work. No accepted new evidence MUST result in zero calls.

Only successful completion of both required independent passes with observed normal finish MAY yield a checkpoint candidate. A candidate is not proof of durable commit, source completeness or a concurrency lease. The caller must separately establish durable commit before presenting the candidate as a committed checkpoint.

### Requirement: Private-data egress is separately authorized

Even after a valid reader exists, sending private conversation evidence to an external model requires a separate provider/data-class authorization and retention/budget review.

Read authority does not imply model-egress authority.

### Requirement: Least privilege is preferred over broad SQL

If a database-facing route is used, it MUST expose the smallest bounded read contract needed by the worker.

Direct arbitrary SQL against one derived search shard MUST NOT be represented as federated or source-complete Session Search evidence.

### Requirement: Intake failure remains visible

Unavailable reader state, stale coverage, partial shards, source/index lag, or unverified currentness MUST remain explicit.

The worker MUST NOT convert these states into `NO_DATA` or absence claims.

## Gate for Future Real-Data Pilot

Real unattended Session Search evidence MAY enter a future pilot only after all of the following are independently verified:

1. bounded machine identity;
2. read-only source/evidence contract;
3. exact provenance;
4. incremental/checkpoint semantics;
5. explicit partial/gap/currentness behavior;
6. private-data egress approval for the selected model route;
7. secret delivery that does not reuse broad operator/App credentials.

Until then, Pilot 2 remains synthetic/publication-safe.

## Spec Dependencies

- `default:worker/core-contract`
