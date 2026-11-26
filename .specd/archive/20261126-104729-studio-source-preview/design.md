# Design: studio-source-preview

## Non-goals

No production runner, additional inference stage, remote calls, private evidence, real checkpoint acknowledgement, new service or persistent ledger.

## Affected areas

- `src/mastra/index.ts` — register the development workflow.
- `src/mastra/workflows/source-batch-preview.ts` — fixed fixture graph using existing kernel.
- `test/studio-source-preview.test.mjs` — registration, graph schema, preview results and rejection tests.
- `docs/studio-source-preview.md` — development scope and maintenance.

## Approach

Four sequential steps: verify-source, prepare-plan, analyze-selected, verify-receipt. Fixed public synthetic test fixture, stable task/version, two deterministic synthetic adapters and fresh per-run in-memory WorkStore. No user-supplied evidence, network route or database connection. Re-derive plan in analysis and verify its identity. Receipt validation reuses the core, never calls acknowledge; output explicitly says preview and checkpointAdvanced=false. Intermediate completion records are synthetic only. Register only in Studio entrypoint, not Cloudflare.

## Testing

API returns registered workflow, graph and input/output schemas; run fixed fixture and reject other inputs. Verify two synthetic work items, four simulated calls, receipt candidate only, no external calls. Canonical QA and exact-head review.

## Spec impact

No normative change. This preview is not durable acceptance; existing PostgreSQL contract remains authoritative.
