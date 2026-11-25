# Design: completion-only-recovery

## Non-goals

No automated retry, candidate storage service, reservation takeover, source cursor or model call.

## Affected areas

- `src/dreaming/durable-pilot2.ts` — strict recovery envelope, shared verified readback, explicit one-attempt persistence recovery.
- `test/durable-pilot2.test.mjs` — fail-first recovery, exact replay, corrupt/unavailable read, wrong token and malformed candidate.
- `qa/postgres/work-atomicity-probe.mjs` — exercise retained candidate recovery on real PostgreSQL after injected rollback.
- `docs/ledger-neon.md` — explain retained-candidate custody and limits.

## Approach

Reuse the existing projection validator and store methods. Only a complete candidate with unknown persistence yields a recovery envelope. Return a cloned candidate plus original token to trusted caller; do not persist raw output. Explicit recovery checks exact projection/work identity before any write, attempts at most one completion using the original token, and verifies readback. Existing PostgreSQL FK and transaction protect against wrong token and racing commits. No claim that a digest authenticates an untrusted caller.

## Testing

RED/GREEN local tests and hosted PostgreSQL existing contract. Preserve prior concurrent, partial and corrupt membership tests. Existing checkpoint mutation shard covers the source.

## Spec impact

Refines failure recovery, without altering source authority or ledger semantics.
