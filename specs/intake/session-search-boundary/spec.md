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

Therefore real unattended intake remains `DEFERRED / UNKNOWN`.

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

### Requirement: Checkpoint advances only after bounded success

The worker checkpoint MUST NOT advance over evidence that was not successfully admitted and processed according to the current analysis contract.

A timestamp alone is insufficient as the durable checkpoint.

The checkpoint SHOULD bind accepted-source identity/fingerprint, analysis-contract version, and analysis scope.

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
