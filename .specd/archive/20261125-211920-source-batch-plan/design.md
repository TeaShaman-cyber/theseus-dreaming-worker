# Design: source-batch-plan

## Non-goals

No real evidence, body persistence, queue, external inference, automatic resume, deployment or privilege changes on live Neon.

## Affected areas

- `src/dreaming/source-batch-receipt.ts` — extract shared verified batch admission and deterministic plan.
- `src/dreaming/source-batch-postgres.ts` — explicit stage/read with predecessor and digest validation.
- `infra/postgres/dw_ledger_v1.sql` — append-only metadata plan table, parent FK.
- `infra/postgres/verify_dw_ledger_v1.sql` — grant and FK checks.
- `test/source-batch-receipt.test.mjs` — plan identity and negative tests.
- `qa/postgres/work-atomicity-probe.mjs` — actual hosted PostgreSQL contract.
- `docs/ledger-neon.md` — lifecycle.

## Approach

Reuse exact selected-work preparation; derive plan before any completion reads. Include original request fingerprint, packet ID, work key, and metadata witness, full handoff and exact predecessor. Exclude input text. Same chain key as checkpoints. Use append-only source_plans with composite FK to checkpoint. Stage under ledger lock, reject advanced parent, independently read back by exact plan key. Lookup by chain/parent with explicit count bound, verify full receipt hash and identity. Do not infer absence from errors. Preserve plans for lineage; synthetic fixture only until retention authorization.

## Testing

Fast fixture tests plus existing heavy-postgres runner. Verify missing/advanced parent, exact retry, competing witnesses, fresh adapter readback, append-only grants, no checkpoint advancement. No local PostgreSQL duplication.

## Spec impact

Adds durable pending custody primitive; does not enforce scheduling or source access.
