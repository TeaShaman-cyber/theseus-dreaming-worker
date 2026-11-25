# Design: source-handoff-decoder

## Non-goals

No actual source read, scheduler, model execution, persistence, authority change or production deployment.

## Affected areas

- `src/dreaming/source-handoff.ts` — strict recovery candidate wire schema and semantic validation.
- `test/source-handoff.test.mjs` — cross-language fixture and negative tests.
- `docs/ledger-neon.md` — consumer boundary and limits.

## Approach

Use strict Zod schemas and existing SHA256 helper with recursively sorted fixed ASCII object keys and Python-compatible JSON strings. Validate canonical membership order and newline-delimited accepted set, ledger entry immutability, expected scope/provider/previous snapshot and catalog. Require exact selected shard identity and derived generation digest. Preserve removals. Trust only explicitly supplied custody/observation; do not infer complete work or build an evidence packet.

## Testing

Actual synthetic producer fixture pinned to SS main; digest mismatch and rehashed semantic counterexamples, catalog mismatch, no mutations. Existing canonical QA.

## Spec impact

Adds a deterministic intake candidate check without changing work identity or storage.
