# Append-only Proposal Ledger Contract

## Purpose

The ledger preserves model-derived proposals as immutable history without turning them into source truth, user preferences, instructions, or canonical memory.

This increment defines only the ledger event contract and deterministic in-memory semantics. It deliberately does not choose or configure a durable storage backend.

## Requirements

### Requirement: Proposal record

A proposal record contains:

- exact Proposal v1 payload and its canonical proposal fingerprint;
- packet, request, and evidence fingerprints;
- perspective identity and configured route identity;
- authority fixed to `DERIVED_ONLY`;
- a deterministic content-addressed record ID.

Hypotheses therefore retain their falsifier, required evidence, competing explanations, uncertainty, and exact evidence references unchanged.

### Requirement: Append-only invariant

Once a proposal record is appended, later operations MUST NOT mutate or delete it.

A revision is represented only by a separate `SUPERSEDE` event linking an existing record to another existing record. Supersession changes only the derived materialized view; it does not rewrite either record and does not imply that the replacement is true.

### Requirement: Content-addressed identity

Record/event identity is derived deterministically from canonical event payload content. Append MUST independently recompute both the embedded Proposal v1 fingerprint and the outer event ID; a forged/stale proposal fingerprint or event ID fails closed.

Proposal fingerprints reuse the same Proposal v1 fingerprint function used by Pilot 2 critique references.

### Requirement: Supersession safety

Supersession requires two existing distinct proposal records.

The ledger MUST reject:

- missing proposal references;
- self-supersession;
- duplicate event IDs;
- cycles in the supersession graph.

The materialized view retains all historical events and records, marks superseded records explicitly, and never deletes history.

### Requirement: Authority boundary

`ACTIVE` means only "not superseded in this ledger view". It MUST NOT be interpreted as `FACT`, accepted truth, memory promotion, instruction, ranking authority, or permission to act.

## Non-scope

No durable database, Neon/Turso choice, checkpoint/lease, scheduler, private Session Search intake, source reader, validation/ranking loop, automatic promotion, publication, or production/go-live.

## Architecture dependencies

- `TeaShaman-cyber/theseus-research#127`
- `TeaShaman-cyber/theseus-research#32`
- `default:worker/core-contract`
- `default:pilot2/critique-contract`
